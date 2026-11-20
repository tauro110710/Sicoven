'use strict';

const crypto = require('node:crypto');
const { hasFullSystemAccess } = require('./auth-roles.cjs');
const { hashOperationRequest, createOperationReceiptIdentity, runIdempotentOperation } = require('./operation-receipts.cjs');

function initializeCompanyMetadataOperationSchema(controlDb) {
  controlDb.exec(`
    CREATE TABLE IF NOT EXISTS company_metadata_intents (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL UNIQUE,
      company_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      request_json TEXT NOT NULL,
      previous_name TEXT NOT NULL,
      previous_rif TEXT NOT NULL,
      next_name TEXT NOT NULL,
      next_rif TEXT NOT NULL,
      actor_user_id INTEGER NOT NULL,
      actor_username TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS company_metadata_intents_company_sequence_idx
      ON company_metadata_intents(company_id, sequence);
    CREATE TABLE IF NOT EXISTS company_metadata_completions (
      operation_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(operation_id) REFERENCES company_metadata_intents(operation_id)
    );
    CREATE TRIGGER IF NOT EXISTS company_metadata_intents_no_update
      BEFORE UPDATE ON company_metadata_intents
      BEGIN SELECT RAISE(ABORT, 'company_metadata_intents is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS company_metadata_intents_no_delete
      BEFORE DELETE ON company_metadata_intents
      BEGIN SELECT RAISE(ABORT, 'company_metadata_intents is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS company_metadata_completions_no_update
      BEFORE UPDATE ON company_metadata_completions
      BEGIN SELECT RAISE(ABORT, 'company_metadata_completions is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS company_metadata_completions_no_delete
      BEFORE DELETE ON company_metadata_completions
      BEGIN SELECT RAISE(ABORT, 'company_metadata_completions is append-only'); END;
    CREATE TABLE IF NOT EXISTS company_creation_intents (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL UNIQUE,
      company_id TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      request_json TEXT NOT NULL,
      actor_user_id INTEGER NOT NULL,
      actor_username TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS company_creation_intents_sequence_idx
      ON company_creation_intents(sequence);
    CREATE TABLE IF NOT EXISTS company_creation_completions (
      operation_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(operation_id) REFERENCES company_creation_intents(operation_id)
    );
    CREATE TRIGGER IF NOT EXISTS company_creation_intents_no_update
      BEFORE UPDATE ON company_creation_intents
      BEGIN SELECT RAISE(ABORT, 'company_creation_intents is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS company_creation_intents_no_delete
      BEFORE DELETE ON company_creation_intents
      BEGIN SELECT RAISE(ABORT, 'company_creation_intents is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS company_creation_completions_no_update
      BEFORE UPDATE ON company_creation_completions
      BEGIN SELECT RAISE(ABORT, 'company_creation_completions is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS company_creation_completions_no_delete
      BEFORE DELETE ON company_creation_completions
      BEGIN SELECT RAISE(ABORT, 'company_creation_completions is append-only'); END;
  `);
}

function registerCompanySessionIpc({
  ipcMain, companySessionContext, runtime, operationContext, controlDb,
  licenseView, getActiveSession, assertOperationalReady = () => {}
}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      !companySessionContext ||
      typeof companySessionContext.listAccessibleCompanies !== 'function' ||
      typeof companySessionContext.selectCompany !== 'function' ||
      typeof companySessionContext.getSelectedCompanyId !== 'function' ||
      !runtime || typeof runtime.createCompany !== 'function' ||
      !operationContext || typeof operationContext.acquireMaintenanceLock !== 'function' ||
      !controlDb || typeof controlDb.prepare !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function' || typeof assertOperationalReady !== 'function') {
    throw new TypeError('No se pudo registrar el IPC seguro de selección y creación de empresa.');
  }

  function getControlDatabase() {
    const db = runtime.controlDb || controlDb;
    if (!db || !db.open || typeof db.prepare !== 'function' || typeof db.exec !== 'function') {
      throw new Error('La base SQLite de control no está disponible para recuperar la operación.');
    }
    return db;
  }

  function requireAuthorizedSession(token) {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!hasFullSystemAccess(actor)) throw new Error('La sesión no está autorizada para administrar empresas.');
    return actor;
  }

  function ensureCompanyMetadataOperationSchema() {
    initializeCompanyMetadataOperationSchema(getControlDatabase());
  }

  ensureCompanyMetadataOperationSchema();

  function completeCompanyMetadataIntent(intent) {
    const db = getControlDatabase();
    const existing = db.prepare(`
      SELECT company_id,request_hash FROM company_metadata_completions WHERE operation_id=?
    `).get(intent.operation_id);
    if (existing) {
      if (String(existing.company_id) !== String(intent.company_id) ||
          String(existing.request_hash) !== String(intent.request_hash)) {
        throw new Error('El cierre de la operación de metadata no coincide con su intención durable.');
      }
      return { completed: true, replayed: true };
    }
    db.prepare(`
      INSERT INTO company_metadata_completions(operation_id,company_id,request_hash)
      VALUES(?,?,?)
    `).run(intent.operation_id, intent.company_id, intent.request_hash);
    return { completed: true, replayed: false };
  }

  function finishCompanyMetadataIntent(intent) {
    const request = JSON.parse(String(intent.request_json || 'null'));
    const expectedRequest = {
      companyId: String(intent.company_id),
      name: String(intent.next_name),
      rif: String(intent.next_rif)
    };
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        JSON.stringify(request) !== JSON.stringify(expectedRequest) ||
        hashOperationRequest(JSON.stringify(request)) !== String(intent.request_hash)) {
      throw new Error('La solicitud durable de metadata está dañada o no coincide con sus valores y huella.');
    }
    const actor = {
      id: Number(intent.actor_user_id),
      username: String(intent.actor_username || '')
    };
    if (!Number.isSafeInteger(actor.id) || actor.id <= 0 || !actor.username) {
      throw new Error('La intención durable de metadata no conserva una identidad de usuario válida.');
    }
    const identity = createOperationReceiptIdentity(
      { operationId: String(intent.operation_id) },
      String(intent.company_id),
      'company.metadata_update',
      request,
      actor
    );
    const tenantDb = runtime.getCompanyDatabase(String(intent.company_id));
    const receipt = runIdempotentOperation(tenantDb, identity, () => {
      const details = {
        operationId: String(intent.operation_id),
        requestHash: String(intent.request_hash),
        companyId: String(intent.company_id),
        actorUserId: actor.id,
        actorUsername: actor.username,
        previous: { name: String(intent.previous_name), rif: String(intent.previous_rif) },
        next: { name: String(intent.next_name), rif: String(intent.next_rif) },
        updatedAt: String(intent.created_at)
      };
      const inserted = tenantDb.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
        .run('company_metadata_updated', JSON.stringify(details));
      return {
        ok: true,
        operationId: String(intent.operation_id),
        companyId: String(intent.company_id),
        auditEventId: Number(inserted.lastInsertRowid),
        requestHash: String(intent.request_hash)
      };
    });
    completeCompanyMetadataIntent(intent);
    return receipt;
  }

  async function reconcilePendingCompanyMetadataOperations() {
    ensureCompanyMetadataOperationSchema();
    const pending = getControlDatabase().prepare(`
      SELECT i.* FROM company_metadata_intents i
      LEFT JOIN company_metadata_completions c ON c.operation_id=i.operation_id
      WHERE c.operation_id IS NULL
      ORDER BY i.sequence
    `).all();
    if (!pending.length) return [];
    let release;
    const results = [];
    try {
      assertOperationalReady();
      release = await operationContext.acquireMaintenanceLock();
      const activeCompanies = new Set(runtime.listCompanies()
        .filter(item => String(item.status) === 'ACTIVE').map(item => String(item.id)));
      for (const intent of pending) {
        if (!activeCompanies.has(String(intent.company_id))) continue;
        try {
          const receipt = finishCompanyMetadataIntent(intent);
          results.push({ operationId: String(intent.operation_id), recovered: true, receipt });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('SICOVEN conserva una actualización de metadata pendiente de reconciliación:', {
            operationId: String(intent.operation_id), companyId: String(intent.company_id), message
          });
          results.push({ operationId: String(intent.operation_id), recovered: false, message });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('No se pudo iniciar la reconciliación de metadata empresarial:', message);
    } finally {
      if (release) release();
    }
    return results;
  }

  function completeCompanyCreationIntent(intent) {
    const db = getControlDatabase();
    const existing = db.prepare(
      'SELECT company_id,request_hash FROM company_creation_completions WHERE operation_id=?'
    ).get(intent.operation_id);
    if (existing) {
      if (String(existing.company_id) !== String(intent.company_id) ||
          String(existing.request_hash) !== String(intent.request_hash)) {
        throw new Error('La finalización de creación no coincide con su intención durable.');
      }
      return { completed: true, replayed: true };
    }
    db.prepare(`
      INSERT INTO company_creation_completions(operation_id,company_id,request_hash)
      VALUES(?,?,?)
    `).run(intent.operation_id, intent.company_id, intent.request_hash);
    return { completed: true, replayed: false };
  }

  function finishCompanyCreationIntent(intent) {
    const request = JSON.parse(String(intent.request_json || 'null'));
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        hashOperationRequest(JSON.stringify(request)) !== String(intent.request_hash)) {
      throw new Error('La solicitud durable de creación está dañada o no coincide con su huella.');
    }
    const companyId = String(intent.company_id);
    if (String(intent.operation_id) !== companyId) {
      throw new Error('La identidad durable de creación no coincide con el ID de empresa.');
    }
    const actor = {
      id: Number(intent.actor_user_id),
      username: String(intent.actor_username || '')
    };
    if (!Number.isSafeInteger(actor.id) || actor.id <= 0 || !actor.username) {
      throw new Error('La intención durable de creación no conserva una identidad de usuario válida.');
    }
    const company = { ...request, id: companyId };
    const operation = { operationId: companyId, requestHash: String(intent.request_hash), actor };
    const registered = runtime.listCompanies().find(item => String(item.id) === companyId);
    const completed = getControlDatabase().prepare(
      'SELECT company_id,request_hash FROM company_creation_completions WHERE operation_id=?'
    ).get(companyId);
    if (completed) {
      if (String(completed.company_id) !== companyId ||
          String(completed.request_hash) !== String(intent.request_hash)) {
        throw new Error('La creación ya finalizada no coincide con la solicitud durable; se bloqueó el reintento.');
      }
      if (!registered) {
        throw new Error('Esta empresa fue creada y posteriormente retirada del registro. No se recreará automáticamente; utilice un nuevo registro de empresa.');
      }
      if (String(registered.status) !== 'ACTIVE') {
        throw new Error('Esta empresa fue creada y posteriormente archivada. No se reactivará automáticamente.');
      }
      runtime.verifyCompanyCreation(company, operation);
      return { ok: true, company: registered, replayed: true };
    }
    let result;
    if (registered) {
      if (String(registered.status) !== 'ACTIVE') {
        throw new Error('La empresa de esta creación durable está archivada; no se reactivará automáticamente.');
      }
      if (String(registered.rif || '').trim().toUpperCase() !== String(company.rif || '').trim().toUpperCase() ||
          String(registered.name || '').trim() !== String(company.name || '').trim()) {
        throw new Error('El registro existente no coincide con la identidad de la solicitud de creación.');
      }
      runtime.verifyCompanyCreation(company, operation);
      result = { ok: true, company: registered, replayed: true };
    } else {
      const orphan = runtime.recoverOrphanedCompany(company, operation);
      if (orphan.found) {
        result = { ok: true, company: orphan.company, replayed: true, recoveredOrphan: true };
      } else {
        result = await runtime.createCompany(company, actor, {
          operationId: companyId,
          requestHash: String(intent.request_hash)
        });
        runtime.verifyCompanyCreation(company, operation);
      }
    }
    completeCompanyCreationIntent(intent);
    return result;
  }

  async function reconcilePendingCompanyCreationOperations() {
    ensureCompanyMetadataOperationSchema();
    const pending = getControlDatabase().prepare(`
      SELECT i.* FROM company_creation_intents i
      LEFT JOIN company_creation_completions c ON c.operation_id=i.operation_id
      WHERE c.operation_id IS NULL
      ORDER BY i.sequence
    `).all();
    if (!pending.length) return [];
    let release;
    const results = [];
    try {
      assertOperationalReady();
      release = await operationContext.acquireMaintenanceLock();
      for (const intent of pending) {
        try {
          const result = await finishCompanyCreationIntent(intent);
          results.push({ operationId: String(intent.operation_id), recovered: true, result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('SICOVEN conserva una creación de empresa pendiente de reconciliación:', {
            operationId: String(intent.operation_id), companyId: String(intent.company_id), message
          });
          results.push({ operationId: String(intent.operation_id), recovered: false, message });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('No se pudo iniciar la reconciliación de creaciones empresariales:', message);
    } finally {
      if (release) release();
    }
    return results;
  }

  function saveActiveCompanyPreference(companyId) {
    getControlDatabase().prepare(`INSERT INTO app_state(state_key,state_json,updated_at)
      VALUES('active_company_preference',?,datetime('now'))
      ON CONFLICT(state_key) DO UPDATE SET state_json=excluded.state_json,updated_at=datetime('now')`)
      .run(JSON.stringify({ companyId: String(companyId), updatedAt: new Date().toISOString() }));
  }

  ipcMain.handle('sicoven:company-list-accessible', async (_event, token) => {
    requireAuthorizedSession(token);
    await reconcilePendingCompanyCreationOperations();
    await reconcilePendingCompanyMetadataOperations();
    return companySessionContext.listAccessibleCompanies(token);
  });

  ipcMain.handle('sicoven:company-registry-status', (_event, token) => {
    requireAuthorizedSession(token);
    const companies = runtime.listCompanies();
    return {
      registeredCount: companies.length,
      activeCount: companies.filter(item => String(item.status) === 'ACTIVE').length,
      companies: companies.map(item => ({
        id: String(item.id), name: String(item.name || ''), rif: String(item.rif || ''),
        status: String(item.status || '')
      }))
    };
  });

  ipcMain.handle('sicoven:company-select-active', async (_event, token, input) => {
    assertOperationalReady();
    requireAuthorizedSession(token);
    const companyId = String(input?.companyId || '').trim();
    if (!companyId || companyId.length > 120) throw new Error('La empresa solicitada no es válida.');
    const result = await companySessionContext.selectCompany(token, companyId,
      operationContext.getActiveCompanyId?.() ? {} : { skipFlush: true });
    saveActiveCompanyPreference(companyId);
    return result;
  });

  ipcMain.handle('sicoven:company-get-active', async (_event, token) => {
    requireAuthorizedSession(token);
    await reconcilePendingCompanyMetadataOperations();
    return { companyId: companySessionContext.getSelectedCompanyId(token) };
  });

  ipcMain.handle('sicoven:company-update-metadata', async (_event, token, input) => {
    assertOperationalReady();
    ensureCompanyMetadataOperationSchema();
    requireAuthorizedSession(token);
    const companyId = String(input?.companyId || '').trim();
    if (!companyId || companyId !== companySessionContext.getSelectedCompanyId(token)) {
      throw new Error('Solo se puede actualizar la ficha de la empresa activa.');
    }
    const name = String(input?.name || '').trim().toUpperCase();
    const rif = String(input?.rif || '').trim().toUpperCase();
    if (!name || !rif) throw new Error('La razón social y el RIF son obligatorios.');
    const operationId = String(input?.operationId || crypto.randomUUID()).trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(operationId) || operationId === '.' || operationId === '..') {
      throw new Error('Falta un identificador estable válido para actualizar la ficha de empresa.');
    }
    const request = { companyId, name, rif };
    const requestJson = JSON.stringify(request);
    const requestHash = hashOperationRequest(requestJson);
    const release = await operationContext.acquireMaintenanceLock();
    try {
      assertOperationalReady();
      const currentSession = requireAuthorizedSession(token);
      if (companySessionContext.getSelectedCompanyId(token) !== companyId) {
        throw new Error('La empresa activa cambió durante la actualización de su ficha.');
      }
      const control = getControlDatabase();
      const existing = control.prepare('SELECT * FROM company_metadata_intents WHERE operation_id=?').get(operationId);
      let intent = existing;
      if (existing) {
        if (String(existing.company_id) !== companyId ||
            String(existing.request_hash) !== requestHash ||
            Number(existing.actor_user_id) !== Number(currentSession.id)) {
          throw new Error('La clave de actualización ya está asociada a otra solicitud, empresa o usuario.');
        }
      } else {
        const current = runtime.listCompanies().find(item =>
          String(item.id) === companyId && String(item.status) === 'ACTIVE'
        );
        if (!current) throw new Error('La empresa activa no está disponible en el registro local.');
        if (String(current.name || '').trim().toUpperCase() === name &&
            String(current.rif || '').trim().toUpperCase() === rif) {
          return { ok: true, company: current, unchanged: true };
        }
        const createIntentAndUpdate = control.transaction(() => {
          control.prepare(`
            INSERT INTO company_metadata_intents
              (operation_id,company_id,request_hash,request_json,previous_name,previous_rif,
               next_name,next_rif,actor_user_id,actor_username)
            VALUES(?,?,?,?,?,?,?,?,?,?)
          `).run(operationId, companyId, requestHash, requestJson,
            String(current.name || ''), String(current.rif || ''), name, rif,
            Number(currentSession.id), String(currentSession.username || ''));
          runtime.updateCompanyMetadata({ companyId, name, rif });
          return control.prepare('SELECT * FROM company_metadata_intents WHERE operation_id=?').get(operationId);
        });
        intent = createIntentAndUpdate();
      }
      const receipt = finishCompanyMetadataIntent(intent);
      const updated = runtime.listCompanies().find(item => String(item.id) === companyId);
      return { ok: true, company: updated || { id: companyId, name, rif }, replayed: Boolean(existing), receipt };
    } finally {
      release();
    }
  });

  ipcMain.handle('sicoven:company-create', async (_event, token, input) => {
    assertOperationalReady();
    ensureCompanyMetadataOperationSchema();
    requireAuthorizedSession(token);
    const company = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : null;
    if (!company) throw new Error('Los datos de la empresa no son válidos.');
    const operationId = String(company.operationId || crypto.randomUUID()).trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(operationId) || operationId === '.' || operationId === '..') {
      throw new Error('Falta un identificador estable válido para la creación de empresa.');
    }
    const requestPayload = { ...company };
    delete requestPayload.operationId;
    delete company.operationId;
    company.id = operationId;
    if (!String(company.name || '').trim() || !String(company.rif || '').trim()) {
      throw new Error('La razón social y el RIF son obligatorios para crear la empresa.');
    }
    const normalizedRif = String(company.rif).trim().toUpperCase();
    const registeredCompanies = runtime.listCompanies();
    const existingCompany = registeredCompanies.find(item => String(item.id) === operationId);
    if (existingCompany && String(existingCompany.status) !== 'ACTIVE') {
      throw new Error('El identificador de esta empresa pertenece a un registro archivado; no se reactivará ni reutilizará.');
    }
    if (existingCompany &&
        (String(existingCompany.rif || '').trim().toUpperCase() !== normalizedRif ||
         String(existingCompany.name || '').trim() !== String(company.name || '').trim())) {
      throw new Error('La clave de creación ya está asociada a otra empresa o ficha; utilice una nueva operación.');
    }
    const duplicateRif = registeredCompanies.find(item =>
      String(item.id) !== operationId &&
      String(item.rif || '').trim().toUpperCase() === normalizedRif
    );
    if (duplicateRif) {
      throw new Error('El RIF ya está asociado a otra empresa del registro local.');
    }
    const requestJson = JSON.stringify(requestPayload);
    const requestHash = hashOperationRequest(requestJson);
    const release = await operationContext.acquireMaintenanceLock();
    let created;
    try {
      assertOperationalReady();
      const currentActor = requireAuthorizedSession(token);
      const control = getControlDatabase();
      let intent = control.prepare('SELECT * FROM company_creation_intents WHERE operation_id=?').get(operationId);
      if (intent) {
        if (String(intent.company_id) !== operationId ||
            String(intent.request_hash) !== requestHash ||
            Number(intent.actor_user_id) !== Number(currentActor.id)) {
          throw new Error('La clave de creación ya está asociada a otra empresa, solicitud o usuario.');
        }
      } else {
        const insertIntent = control.transaction(() => {
          control.prepare(`
            INSERT INTO company_creation_intents
              (operation_id,company_id,request_hash,request_json,actor_user_id,actor_username)
            VALUES(?,?,?,?,?,?)
          `).run(operationId, operationId, requestHash, requestJson,
            Number(currentActor.id), String(currentActor.username || ''));
          return control.prepare('SELECT * FROM company_creation_intents WHERE operation_id=?').get(operationId);
        });
        intent = insertIntent();
      }
      created = await finishCompanyCreationIntent(intent);
    } finally {
      release();
    }
    const selection = await companySessionContext.selectCompany(token, company.id, { skipFlush: true });
    saveActiveCompanyPreference(company.id);
    return { ...created, selection };
  });
}

module.exports = { registerCompanySessionIpc };
