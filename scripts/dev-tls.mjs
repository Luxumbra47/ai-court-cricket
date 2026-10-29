import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import selfsigned from 'selfsigned';
if (!existsSync('.cert/localhost.pem') || !existsSync('.cert/localhost-key.pem')) {
  mkdirSync('.cert', { recursive: true });
  const result = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    days: 30, keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }]
  });
  writeFileSync('.cert/localhost.pem', result.cert);
  writeFileSync('.cert/localhost-key.pem', result.private, { mode: 0o600 });
}
console.log('Local TLS certificate ready. For LAN/public play use a trusted certificate and HTTPS reverse proxy; see README.');
