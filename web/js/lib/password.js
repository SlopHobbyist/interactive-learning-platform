/* Generated passwords. Learners never choose one: sign-up and recovery hand them 32 random
   printable ASCII characters from the browser's CSPRNG and ask them to save it. */

// The 94 printable ASCII characters, '!' (33) to '~' (126). No space.
const ALPHABET = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join('');

export const PASSWORD_LENGTH = 32;

export function generatePassword(length = PASSWORD_LENGTH) {
  const out = [];
  const bytes = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      // Accept 0..187 only (2 × 94) so `b % 94` has no modulo bias.
      if (b < 188 && out.length < length) out.push(ALPHABET[b % 94]);
    }
  }
  return out.join('');
}
