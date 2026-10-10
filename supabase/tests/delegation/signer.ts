export async function makeSigner() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", publicKey));
  const b64 = btoa(String.fromCharCode(...spki));
  const pem = `-----BEGIN PUBLIC KEY-----\n${
    b64.match(/.{1,64}/g)!.join("\n")
  }\n-----END PUBLIC KEY-----`;

  async function sign(
    url: string,
    body: string,
    timestamp: number,
  ): Promise<string> {
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${timestamp}.${url}.${hash}`),
    );
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }

  return { pem, sign };
}
