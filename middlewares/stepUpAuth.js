import Boom from '@hapi/boom'
import Auth from '../services/auth.service.js'

const auth = new Auth()

// Lockout en memoria por usuario. El proyecto no tiene rate-limiter; si algún día
// se despliega en varias instancias, mover esto a una colección o a Redis.
const MAX_ATTEMPTS = 5
const LOCK_MS = 15 * 60 * 1000
const attempts = new Map() // userId -> { count, until }

const userIdFrom = (req) => String(req.user?._id ?? req.user?.userId ?? req.user?.id ?? '')

const readPassword = (req) => {
  const fromHeader = req.headers['x-confirm-password']
  const fromBody = req.body?.__confirmPassword
  return fromHeader || fromBody || ''
}

// Middleware de re-autenticación para acciones sensibles (bajas en cascada,
// reversión de pagos, ediciones fuera del flujo normal, etc.).
//
// Espera la contraseña del usuario en sesión en el header `X-Confirm-Password`
// (o en `body.__confirmPassword`). Si es correcta:
//   - la elimina del request para que nunca llegue a servicios ni a snapshots de auditoría
//   - marca `req.audit.override = true` para habilitar el bypass de candados de negocio
//   - marca `req.audit.confirmedWithPassword = true` para dejar rastro en la bitácora
export const requirePassword = async (req, res, next) => {
  const userId = userIdFrom(req)

  try {
    if (!userId) throw Boom.unauthorized('Usuario no autenticado')

    const lock = attempts.get(userId)
    if (lock?.until && lock.until > Date.now()) {
      const mins = Math.ceil((lock.until - Date.now()) / 60000)
      throw Boom.tooManyRequests(`Demasiados intentos fallidos. Intenta de nuevo en ${mins} min.`)
    }
    if (lock?.until && lock.until <= Date.now()) {
      attempts.delete(userId)
    }

    const password = readPassword(req)
    await auth.verifyPassword(userId, password)

    attempts.delete(userId)

    // Limpieza: la contraseña no debe viajar más allá de este punto.
    if (req.body && '__confirmPassword' in req.body) delete req.body.__confirmPassword
    delete req.headers['x-confirm-password']

    if (!req.audit) req.audit = {}
    req.audit.override = true
    req.audit.confirmedWithPassword = true

    next()
  } catch (err) {
    // Solo cuentan como intento fallido las credenciales incorrectas (401),
    // no un rol inválido (403) ni un lockout ya activo (429).
    if (err?.output?.statusCode === 401 && userId) {
      const cur = attempts.get(userId) || { count: 0 }
      cur.count += 1
      if (cur.count >= MAX_ATTEMPTS) cur.until = Date.now() + LOCK_MS
      attempts.set(userId, cur)
    }
    next(err)
  }
}

// Expuesto para pruebas / operación manual.
export const _clearAttempts = () => attempts.clear()

export default requirePassword
