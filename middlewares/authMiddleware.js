import Boom from "@hapi/boom"
import jwt from 'jsonwebtoken'
import config from "../config.js"

const authenticate = (req,res,next)=>{
  try {
    const authHeader = req.headers.authorization
    if(!authHeader || !authHeader.startsWith('Bearer ')){
      throw Boom.unauthorized('Token no proporcionado')
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, config.jwtSecret)

    req.user = decoded
    next()

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(Boom.unauthorized('Token inválido'));
    } else if (error.name === 'TokenExpiredError') {
      next(Boom.unauthorized('Token expirado'));
    } else {
      next(error);
    }
  }
}

const authorize = (...allowedRoles)=>{
  return (req,res,next)=>{
    if(!req.user){
      return next(Boom.unauthorized('Usuario no autenticado'))
    }
    console.log(req.user)

    if(!allowedRoles.includes(req.user.role)){
      return next(Boom.unauthorized('Usuario no tiene permisos para esta acción'))
    }

    next()
  }
}

export { authenticate, authorize}
