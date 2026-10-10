import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
Deno.test("account phone: unique registration, trusted canonical mapping, single-use links and RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create role service_role; create schema auth;
 create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz,deleted_at timestamptz,raw_user_meta_data jsonb,raw_app_meta_data jsonb);
 insert into auth.users values('11111111-1111-4111-8111-111111111111','359888123456',now(),null,'{}','{}');`,
    );
    await db.exec(
      await Deno.readTextFile(
        new URL(
          "../../migrations/20261010175000_unique_phone_accounts.sql",
          import.meta.url,
        ),
      ),
    );
    const id = "11111111-1111-4111-8111-111111111111";
    const value = async (sql: string) => (await db.query(sql)).rows[0] as any;
    assertEquals(
      (await value("select nova_user_id_by_phone('+359 888 123 456') id")).id,
      id,
    );
    await assertRejects(() =>
      db.exec(
        `insert into auth.users(id,raw_user_meta_data) values('22222222-2222-4222-8222-222222222222','{"contact_phone":"+359888123456"}')`,
      )
    );
    await assertRejects(() =>
      db.exec(`update auth.users set phone='359899123456' where id='${id}'`)
    );
    await db.exec(
      `insert into account_access_keys values('secret','${id}','link',now()+interval '1 minute')`,
    );
    assertEquals((await value("select alo_redeem_access('secret') id")).id, id);
    assertEquals(
      (await value("select alo_redeem_access('secret') id")).id,
      null,
    );
    await db.exec(
      `insert into account_access_keys values('expired','${id}','device',now()-interval '1 minute')`,
    );
    assertEquals(
      (await value("select alo_redeem_access('expired') id")).id,
      null,
    );
    await db.exec("set role authenticated");
    await assertRejects(() => db.exec("select * from account_access_keys"));
    await assertRejects(() => db.exec("select alo_redeem_access('secret')"));
  } finally {
    await db.close();
  }
});
