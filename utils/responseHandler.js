// src/utils/responseHandler.js

/**
 * Respuesta exitosa estándar
 * @param {Object} res - Response object de Express
 * @param {*} data - Datos a enviar
 * @param {String} message - Mensaje opcional
 * @param {Number} statusCode - Código de estado HTTP (default 200)
 */
export const successResponse = (res, data, message = 'Operación exitosa', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  })
}

/**
 * Respuesta de error estándar
 * @param {Object} res - Response object de Express
 * @param {String} message - Mensaje de error
 * @param {Number} statusCode - Código de estado HTTP (default 500)
 * @param {*} errors - Detalles adicionales del error
 */
export const errorResponse = (res, message = 'Error en la operación', statusCode = 500, errors = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors })
  })
}
