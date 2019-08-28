import crypto from 'crypto'
import { Keccak } from 'sha3'
import { v4 as uuid } from 'uuid'

import { UnsupportedCipher, IncorrectPassword, InvalidKeystore } from 'exceptions'
import { ExtendedPrivateKey } from './key'

const CIPHER = 'aes-128-ctr'

interface CipherParams {
  iv: string
}

interface KdfParams {
  dklen: number
  n: number
  r: number
  p: number
  salt: string
}

interface Crypto {
  cipher: string
  cipherparams: CipherParams
  ciphertext: string
  kdf: string
  kdfparams: KdfParams
  mac: string
}

// Encrypt and save master extended private key.
export default class Keystore {
  crypto: Crypto
  id: string
  version: number = 3

  constructor(theCrypto: Crypto, id: string) {
    this.crypto = theCrypto
    this.id = id
  }

  static fromJson = (json: string) => {
    try {
      const object = JSON.parse(json)
      return new Keystore(object.crypto, object.id)
    } catch {
      throw new InvalidKeystore()
    }
  }

  static create = (
    extendedPrivateKey: ExtendedPrivateKey,
    password: string,
    options: { salt?: Buffer; iv?: Buffer } = {}
  ) => {
    const salt = options.salt || crypto.randomBytes(32)
    const iv = options.iv || crypto.randomBytes(16)
    const kdfparams: KdfParams = {
      dklen: 32,
      salt: salt.toString('hex'),
      n: 8192,
      r: 8,
      p: 1,
    }
    const derivedKey = crypto.scryptSync(password, salt, kdfparams.dklen, {
      N: kdfparams.n,
      r: kdfparams.r,
      p: kdfparams.p,
    })

    const cipher = crypto.createCipheriv(CIPHER, derivedKey.slice(0, 16), iv)
    if (!cipher) {
      throw new UnsupportedCipher()
    }
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(extendedPrivateKey.serialize(), 'hex')),
      cipher.final(),
    ])
    const mac = new Keccak(256).update(Buffer.concat([derivedKey.slice(16, 32), ciphertext])).digest('hex')

    return new Keystore(
      {
        ciphertext: ciphertext.toString('hex'),
        cipherparams: {
          iv: iv.toString('hex'),
        },
        cipher: CIPHER,
        kdf: 'scrypt',
        kdfparams,
        mac,
      },
      uuid()
    )
  }

  // Decrypt and return serialized extended private key.
  decrypt(password: string): string {
    const derivedKey = this.derivedKey(password)
    const ciphertext = Buffer.from(this.crypto.ciphertext, 'hex')
    if (this.mac(derivedKey, ciphertext) !== this.crypto.mac) {
      throw new IncorrectPassword()
    }
    const decipher = crypto.createDecipheriv(
      this.crypto.cipher,
      derivedKey.slice(0, 16),
      Buffer.from(this.crypto.cipherparams.iv, 'hex')
    )
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('hex')
  }

  extendedPrivateKey = (password: string): ExtendedPrivateKey => {
    return ExtendedPrivateKey.parse(this.decrypt(password))
  }

  checkPassword = (password: string) => {
    const derivedKey = this.derivedKey(password)
    const ciphertext = Buffer.from(this.crypto.ciphertext, 'hex')
    return this.mac(derivedKey, ciphertext) === this.crypto.mac
  }

  derivedKey = (password: string) => {
    const { kdfparams } = this.crypto
    return crypto.scryptSync(password, Buffer.from(kdfparams.salt, 'hex'), kdfparams.dklen, {
      N: kdfparams.n,
      r: kdfparams.r,
      p: kdfparams.p,
    })
  }

  mac = (derivedKey: Buffer, ciphertext: Buffer) => {
    return new Keccak(256).update(Buffer.concat([derivedKey.slice(16, 32), ciphertext])).digest('hex')
  }
}
