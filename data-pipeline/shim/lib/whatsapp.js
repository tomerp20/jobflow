// WhatsApp client wrapper for the Notifier route (see ADR 0011).
//
// Hides the whatsapp-web.js lifecycle (QR auth, ready/disconnected state,
// sending) behind a small surface: isReady() / enqueue(text) / init().
//
// Isolation: this module never throws into the shim's HTTP path. A dead or
// unauthenticated Chromium just means isReady() === false, so /notify returns
// 503 while /companies keeps serving. Initialisation failures are logged, not
// propagated.
//
// Throttle: sends are serialised through a queue with a minimum gap between
// messages, so a bulk Email Agent sync that creates N Applications doesn't fire
// N near-simultaneous WhatsApp messages (a spam-shaped pattern).

import wweb from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { toChatId } from './message.js';

const { Client, LocalAuth } = wweb;

const MIN_SEND_INTERVAL_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createWhatsApp({ recipient, logger, executablePath }) {
  const chatId = toChatId(recipient);

  let ready = false;
  const queue = [];
  let draining = false;

  const client = new Client({
    authStrategy: new LocalAuth(), // persists to .wwebjs_auth (host-mounted)
    puppeteer: {
      headless: true,
      executablePath, // system Chromium (Debian slim); undefined → puppeteer default
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    },
  });

  client.on('qr', (qr) => {
    // First-run auth: render the QR as ASCII so it can be scanned from an SSH
    // session / `docker logs jf-shim`. Scanned once; the session is then
    // persisted to the host-mounted .wwebjs_auth directory.
    logger.warn('whatsapp.qr_required — scan this QR with WhatsApp on the sender phone');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => logger.info('whatsapp.authenticated'));

  client.on('ready', () => {
    ready = true;
    logger.info({ chatId }, 'whatsapp.ready');
  });

  client.on('auth_failure', (msg) => {
    ready = false;
    logger.error({ msg }, 'whatsapp.auth_failure — re-scan required');
  });

  client.on('disconnected', (reason) => {
    ready = false;
    logger.error({ reason }, 'whatsapp.disconnected — sends will 503 until reconnected');
  });

  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length > 0) {
      // If the session dropped mid-drain, stop and log the loss explicitly
      // rather than throw on every send. This is the ADR 0011 "silent death"
      // edge — made loud here so it shows up in `docker logs jf-shim`.
      if (!ready) {
        logger.warn({ dropped: queue.length }, 'whatsapp.not_ready_mid_drain — dropping queued messages');
        queue.length = 0;
        break;
      }
      const text = queue.shift();
      try {
        await client.sendMessage(chatId, text);
        logger.info('whatsapp.sent');
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'whatsapp.send_failed');
      }
      if (queue.length > 0) await sleep(MIN_SEND_INTERVAL_MS);
    }
    draining = false;
  }

  return {
    isReady: () => ready,
    enqueue(text) {
      queue.push(text);
      // Fire-and-forget; drain serialises and paces the sends itself.
      drain();
    },
    init() {
      return client.initialize();
    },
  };
}
