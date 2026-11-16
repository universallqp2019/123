
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { migrate } from './db/schema';
import { registerServices } from './services';

let db: Database.Database;
let api: any;

const dbPath = () =>
  path.join(app.getPath('userData'), 'data', 'universal-pos.sqlite');

function initDb() {
  fs.mkdirSync(path.dirname(dbPath()), { recursive: true });

  db = new Database(dbPath());
  db.pragma('journal_mode=WAL');
  db.pragma('foreign_keys=ON');

  migrate(db);
  api = registerServices(db);
}

function backup() {
  db.pragma('wal_checkpoint(TRUNCATE)');

  const r = dialog.showSaveDialogSync({
    title: 'Backup Universal Computers POS',
    defaultPath: `UniversalPOS-Backup-${new Date().toISOString().slice(0, 10)}.sqlite`,
    filters: [
      { name: 'SQLite Backup', extensions: ['sqlite', 'db'] }
    ]
  });

  if (!r) return { cancelled: true };

  fs.copyFileSync(dbPath(), r);
  return { path: r };
}

function restore() {
  const r = dialog.showOpenDialogSync({
    title: 'Restore POS database backup',
    properties: ['openFile'],
    filters: [
      { name: 'SQLite Backup', extensions: ['sqlite', 'db'] }
    ]
  });

  if (!r?.[0]) return { cancelled: true };

  const check = new Database(r[0], { readonly: true });
  check.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
  check.close();

  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  fs.copyFileSync(r[0], dbPath());
  initDb();

  return { ok: true };
}

function registerIpc() {
  const h: Record<string, (...args: any[]) => any> = {
    products: () => api.listProducts(),
    productSave: (_e: any, p: any) => api.saveProduct(p),
    customers: () => api.listCustomers(),
    customerSave: (_e: any, c: any) => api.saveCustomer(c),
    saleCreate: (_e: any, s: any) => api.createSale(s),
    sales: () => api.sales(),
    saleDetail: (_e: any, id: number) => api.saleDetail(id),
    dashboard: () => api.dashboard(),
    customerPayment: (_e: any, p: any) => api.addCustomerPayment(p),
    customerLedger: (_e: any, id: number) => api.customerLedger(id),
    saleVoid: (_e: any, id: number) => api.voidSale(id),
    expenses: () => api.expenses(),
    expenseAdd: (_e: any, e: any) => api.addExpense(e),
    report: (_e: any, r: any) => api.report(r.from, r.to),
    backup: () => backup(),
    restore: () => restore()
  };

  for (const [k, v] of Object.entries(h)) {
    ipcMain.handle(k, (event, ...args) => v(event, ...args));
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 950,
    minHeight: 650,
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  initDb();
  registerIpc();
  createWindow();
});

app.on('before-quit', () => {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
