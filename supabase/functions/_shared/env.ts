export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return Deno.env.get(name) || undefined;
}
