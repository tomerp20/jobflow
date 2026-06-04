// Pure helpers for the WhatsApp Notifier route (see ADR 0011).
//
// Kept dependency-free and side-effect-free so the formatting and recipient
// rules are trivial to reason about in isolation.

// Single hardcoded recipient (Netali). The recipient lives shim-side so the
// number/wording can change with a box-side edit + restart — JobFlow never
// knows who is messaged (it sends only { company, role, url }).
export const RECIPIENT = '+972525912293';

// whatsapp-web.js addresses chats by `<countrycode><number>@c.us` with no
// '+', spaces, or dashes. Normalise any human-formatted number to that form.
export function toChatId(rawNumber) {
  const digits = String(rawNumber).replace(/\D/g, '');
  return `${digits}@c.us`;
}

// Render the outbound WhatsApp Message. The link line is dropped when the
// Application has no job-posting URL; company + role alone is still sent.
export function formatMessage({ company, role, url }) {
  const lines = [
    'Hey Netali, I found new position, Here are the Details:',
    `${company} — ${role}`,
  ];
  if (typeof url === 'string' && url.trim() !== '') {
    lines.push(url.trim());
  }
  return lines.join('\n');
}
