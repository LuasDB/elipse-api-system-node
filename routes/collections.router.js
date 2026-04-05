import express from 'express';
import Collection from './../services/collections.service.js'
import uploadFiles from './../middlewares/multer-upload-files.js'
import Boom from '@hapi/boom';

const router = express.Router();
const collections = new Collection()

const collectionsRouter = (io)=>{

  router.get('/:collection', async(req, res,next) => {
    const { collection } = req.params
    try {
      const result = await collections.getAll(collection)

      io.emit('mensaje_respuesta',{message:'Se hizo una consulta de todo'})

      res.status(200).json({
        success:true,
        message:'Documentos encontrados',
        data:result
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:collection/search/',async(req,res,next)=>{
    try{
      const { collection} = req.params
      const { q,page,limit } = req.query

      const serach = await collections.search(collection,q,page,limit)
      res.status(200).json({
        success:true,
        message:'Documentos encontrados',
        data:serach
      })
    }catch(error){
      next(error)
    }
  })

  router.get('/:collection/:id',async(req,res,next)=>{
    try {
      const { collection, id } = req.params
      const doc = await collections.getOneById(collection,id)

      io.emit('mensaje_respuesta',{message:'Se consulto un documento'})

      res.status(200).json({
        success:true,
        message:'Documento obtenido',
        data:doc
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/create/:collection',async(req,res,next)=>{

    try {
      const { collection } = req.params
      const { body } = req
      const newReg = await collections.create(collection,body)

      io.emit('mensaje_respuesta',{message:'Se creo un documento'})

      res.status(201).json({
        success:true,
        message:'Registro creado',
        data:newReg

      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/add-files-data/:collection',uploadFiles,async(req,res,next)=>{
    const uploadMiddlewere = req.upload.any()

    uploadMiddlewere(req,res,async(err)=>{
      if(err){
        throw Boom.unsupportedMediaType('Error al subir archivos')
      }

      const { files,body } = req
      const { collection } = req.params


      try {
        const addFiles = await collections.addFIles(collection,files,body)

        io.emit('mensaje_respuesta',{message:'Se creo un documento junto con archivos'})

        return res.status(201).json({
          success:true,
          message:'Subidos con exito',
          data:addFiles
        })
      } catch (error) {
        next(error)
      }


    })
  })

  router.post('/example-email-handlebars',async(req,res,next)=>{
    try {
      const sendEmail = await collections.sendEmail(req.body)

      res.status(200).json(
        {
          success:true,
          message:'Correo enviado',
          data:sendEmail
        }
      )
    } catch (error) {
      next(error)
    }
  })

  router.patch('/update-one/:collection/:id',async(req,res,next)=>{
    try {
      const { collection,id} =req.params
      const newData = req.body
      const updateOne = await collections.updateOneById(collection,id,newData)

      io.emit('mensaje_respuesta',{mensaje:'Se modifico uno'})

      res.status(200).json({
        success:true,
        message:'Actualizado con éxito',
        data:updateOne
      })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/delete-one/:collection/:id',async(req,res,next)=>{
    try {
      const { collection, id } = req.params
      const deleteOne = await collections.deleteOneById(collection,id)

      io.emit('mensaje_respuesta',{message:'Se elimino uno'})

      res.status(200).json({
        success:true,
        message:'Registro eliminado',
        data:deleteOne
      })

    } catch (error) {
      next(error)
    }
  })

  return router
}

export default collectionsRouter
