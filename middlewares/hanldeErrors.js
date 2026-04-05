import  Boom  from "@hapi/boom"
const logErrors = (err, req, res, next) => {
  console.error('[LOG ERROR]:',err)
  next(err)
}

const errorHandler = (err, req, res, next) => {
  if(Boom.isBoom(err)){
    res.status(err.output.statusCode).json(err.output.payload)
  }else{
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
}
export {
    logErrors,errorHandler
}
