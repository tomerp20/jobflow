// Pure helpers for the WhatsApp Notifier route (see ADR 0011).
//
// Kept dependency-free and side-effect-free so the formatting and recipient
// rules are trivial to reason about in isolation.

// Single hardcoded recipient (Netali). The recipient lives shim-side so the
// number/wording can change with a box-side edit + restart — JobFlow never
// knows who is messaged (it sends only { company, role, url }).
export const RECIPIENT = '+972544483175';

// whatsapp-web.js addresses chats by `<countrycode><number>@c.us` with no
// '+', spaces, or dashes. Normalise any human-formatted number to that form.
export function toChatId(rawNumber) {
  const digits = String(rawNumber).replace(/\D/g, '');
  return `${digits}@c.us`;
}

// Collapse any whitespace run — including newlines, carriage returns and tabs —
// to a single space, then trim. company/role are user-controlled card fields,
// so an embedded newline could otherwise forge extra lines (e.g. a spoofed link
// line) in the outbound message. `\s` covers \n \r \t \f \v, which is exactly
// the line-forging surface.
function sanitizeField(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

// Only emit the link line for a syntactically valid http(s) URL; drop anything
// else (malformed, or whitespace/control-char-laden) rather than risk a forged
// line.
function sanitizeUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

// Render the outbound WhatsApp Message. The link line is dropped when the
// Application has no (valid) job-posting URL; company + role alone is still sent.
export function formatMessage({ company, role, url }) {
  const lines = [
    'Hey Netali, I found new position, Here are the Details:',
    `${sanitizeField(company)} — ${sanitizeField(role)}`,
  ];
  const cleanUrl = sanitizeUrl(url);
  if (cleanUrl) {
    lines.push(cleanUrl);
  }
  return lines.join('\n');
}
