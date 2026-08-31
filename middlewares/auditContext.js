import { actorFrom } from '../utils/audit.util.js'

// Construye el contexto de auditoría a partir de la petición autenticada:
// actor normalizado + metadatos (ip, user-agent). Los servicios lo reciben como
// último parámetro y lo pasan a auditLog.record().
export const buildAuditContext = (req) => {
  const forwarded = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  return {
    actor: actorFrom(req.user),
    ip: forwarded || req.socket?.remoteAddress || req.ip || null,
    userAgent: req.headers?.['user-agent'] || null,
    // Se activan en `requirePassword` (middlewares/stepUpAuth.js) cuando el usuario
    // confirma su contraseña. `override` habilita el bypass de candados de negocio
    // reservado al admin; `confirmedWithPassword` deja rastro en la bitácora.
    override: false,
    confirmedWithPassword: false
  }
}

// Middleware equivalente (deja req.audit). `authenticate` ya lo hace, así que
// normalmente no hace falta montarlo aparte.
const auditContext = (req, res, next) => {
  req.audit = buildAuditContext(req)
  next()
}

export default auditContext
