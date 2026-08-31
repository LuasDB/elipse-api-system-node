import express from 'express'
import Boom from '@hapi/boom'
import Users from '../services/users.service.js'
import { authenticate,authorize } from '../middlewares/authMiddleware.js'

const router = express.Router()
const user = new Users()

const usersRouter = (io)=>{

  router.get('/',authenticate,async(req, res,next )=>{
    try {
      const filter ={
        role:req.query.role,
        active:req.query.active,
        search:req.query.search
      }

      // El módulo de Usuarios es solo para admin. Se exceptúa la búsqueda
      // de vendedores, que otros roles necesitan para asignar el vendedor de un contrato.
      const isSellerLookup = filter.role === 'vendedor' && !filter.search
      if(req.user.role !== 'admin' && !isSellerLookup){
        throw Boom.forbidden('No tienes permiso para ver el listado de usuarios')
      }

      const result = await user.getAll(filter)

      res.status(200).json({
        success:true,
        data:result
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:id',authenticate,authorize('admin'),async(req, res,next )=>{
    try {
      const { id } = req.params
      const result = await user.getOneById(id)

      res.status(200).json({
        success:true,
        data:result
      })
    } catch (error) {
      next(error)
    }
  })

  router.patch('/:id',authenticate,authorize('admin'),async(req, res,next )=>{
    try {
      const { body } = req
      const { id } = req.params
      const result = await user.updateOneById(id, body, req.audit)
      res.status(200).json({
        success:true,
        message:'Registro actualizado',
        data:result
      })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/:id',authenticate,authorize('admin'),async(req, res,next )=>{
    try {
      const { id } = req.params
      const result = await user.deleteOneById(id, req.audit)

      res.status(200).json({
        success:true,
        message:'Registro eliminado',
        data:result
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}

export default usersRouter
