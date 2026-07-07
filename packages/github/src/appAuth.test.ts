import { createVerify, generateKeyPairSync } from 'node:crypto';
import { createAppJwt } from './appAuth';

describe('createAppJwt', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('produces a verifiable RS256 JWT with GitHub App claims', () => {
    const now = 1_750_000_000;
    const jwt = createAppJwt('12345', pem, now);
    const [header, payload, signature] = jwt.split('.');
    expect(header && payload && signature).toBeTruthy();

    const decode = (part: string) =>
      JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(decode(header!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(payload!)).toEqual({ iat: now - 60, exp: now + 540, iss: '12345' });

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    const sigBuf = Buffer.from(signature!.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(verifier.verify(publicKey, sigBuf)).toBe(true);
  });
});
