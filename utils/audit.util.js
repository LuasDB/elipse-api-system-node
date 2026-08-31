// Utilidades compartidas para la bitácora de auditoría (auditLogs)

// Campos que nunca deben quedar registrados en texto plano dentro de un
// snapshot o de un diff de cambios.
export const SENSITIVE_FIELDS = ['password', 'passwordHash', 'hashedPassword', 'token', 'resetToken', '__v']

// Campos de "ruido" que no aportan valor al historial de cambios.
export const IGNORED_FIELDS = ['_id', 'createdAt', 'updatedAt']

// Objeto "plano" real: descarta Date, Buffer, ObjectId y demás tipos BSON,
// que no deben recorrerse campo a campo.
const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false
  if (value instanceof Date) return false
  if (Buffer.isBuffer(value)) return false
  if (value._bsontype || typeof value.toHexString === 'function') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Normaliza tipos no primitivos (Date, ObjectId) para poder comparar y guardar.
const normalizeValue = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && typeof value.toHexString === 'function') {
    return value.toString()
  }
  return value
}

// Serialización estable (llaves ordenadas) para comparar dos valores por contenido.
export const stableStringify = (value) => {
  const build = (val) => {
    const normalized = normalizeValue(val)
    if (Array.isArray(normalized)) return normalized.map(build)
    if (isPlainObject(normalized)) {
      return Object.keys(normalized)
        .sort()
        .reduce((acc, key) => {
          acc[key] = build(normalized[key])
          return acc
        }, {})
    }
    return normalized
  }
  return JSON.stringify(build(value))
}

// Escapa una cadena para usarla dentro de un RegExp (búsquedas de auditoría).
export const escapeRegex = (text = '') =>
  String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Convierte un req.user (o un actor ya normalizado) en la forma estándar
// que se guarda en cada registro de auditoría.
export const actorFrom = (user) => {
  if (!user) return { userId: null, name: null, email: null, role: null }
  const rawId = user.userId ?? user._id ?? user.id ?? null
  return {
    userId: rawId ? String(rawId) : null,
    name: user.name || null,
    email: user.email || null,
    role: user.role || null
  }
}

// Reemplaza recursivamente los campos sensibles por '***'. Se usa para los
// snapshots de registros borrados.
export const sanitize = (value, extraSensitive = []) => {
  const sensitive = new Set([...SENSITIVE_FIELDS, ...extraSensitive])
  const walk = (val) => {
    if (Array.isArray(val)) return val.map(walk)
    if (isPlainObject(val)) {
      return Object.entries(val).reduce((acc, [key, inner]) => {
        acc[key] = sensitive.has(key) ? '***' : walk(inner)
        return acc
      }, {})
    }
    return val
  }
  return walk(value)
}

// Calcula la lista de cambios { field, from, to } comparando el estado previo
// contra el payload aplicado. Sólo se consideran las llaves presentes en `after`
// (típicamente el body de un PATCH), de modo que un update parcial sólo registra
// lo que realmente se tocó.
export const diff = (before = {}, after = {}, { ignore = [] } = {}) => {
  const skip = new Set([...IGNORED_FIELDS, ...SENSITIVE_FIELDS, ...ignore])
  const previous = before || {}
  const next = after || {}
  const changes = []

  for (const field of Object.keys(next)) {
    if (skip.has(field)) continue
    const fromValue = previous[field]
    const toValue = next[field]
    if (stableStringify(fromValue) === stableStringify(toValue)) continue
    changes.push({
      field,
      from: normalizeValue(fromValue) ?? null,
      to: normalizeValue(toValue) ?? null
    })
  }

  return changes
}
