import fs from 'fs';
import path from 'path';
process.env.PGDATABASE = 'danacorp';

async function main() {
  const { db, pool } = await import('../db');
  const OUT = path.join(process.cwd(), '_del-result.json');
  try {
    const before = await db.all("SELECT estado, COUNT(*)::int AS n FROM quotation_drafts GROUP BY estado ORDER BY estado");
    const del = await db.run("DELETE FROM quotation_drafts WHERE estado = 'borrador'");
    const after = await db.all("SELECT estado, COUNT(*)::int AS n FROM quotation_drafts GROUP BY estado ORDER BY estado");
    fs.writeFileSync(OUT, JSON.stringify({ ok: true, antes: before, borrados: del.changes, despues: after }, null, 2));
  } catch (e) {
    fs.writeFileSync(OUT, JSON.stringify({ ok: false, msg: (e as Error).message }, null, 2));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
main();
