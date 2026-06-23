import Database from 'better-sqlite3';
const db = new Database('../danacorp-project/danacorp.db', { readonly: true });
console.log('projects:', (db.prepare('SELECT COUNT(*) as n FROM projects').get() as any).n);
console.log('clients:', (db.prepare('SELECT COUNT(*) as n FROM clients').get() as any).n);
console.log('units:', (db.prepare('SELECT COUNT(*) as n FROM units').get() as any).n);
db.close();
