import express from 'express'
import Auth from './../services/auth.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'

const router = express.Router()
const auth = new Auth()

// El alta de usuarios se hace desde el panel (módulo Usuarios, solo admin).
// Se exige sesión para poder registrar en la bitácora QUIÉN crea cada usuario.
router.post('/register', authenticate, authorize('admin'), async(req, res, next)=>{
  try {
    const newRegister = await auth.create(req.body, req.audit)
    if(newRegister){
      res.status(200).json({
        success:true,message:'Creado',data:newRegister
      })
    }

  } catch (error) {
    next(error)
  }
})

router.post('/login',async(req, res, next)=>{
  try {
    console.log('Tocando a login')
    const token = await auth.login(req.body)
    if(token){
      res.status(200).json({
        success:true,
        message:'Acceso',
        data:token
      })
    }
  } catch (error) {
    next(error)
  }
})

router.post('/forgot-password',async(req, res, next)=>{
  try {
    const request = await auth.forgotPassword(req.body)
    if(request){
      res.status(200).json({
        success:true,message:request
      })
    }
  } catch (error) {
    next(error)
  }
})

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body
    const response = await auth.resetPassword(token, newPassword)

    res.status(200).json({
      success:true,
      message:response})
  } catch (error) {
    next(error)
  }
});

// Pre-validación de la contraseña para acciones sensibles ("step-up auth").
// El frontend la llama antes de mostrar la confirmación final, para dar feedback
// inmediato. La autorización real la vuelve a checar `requirePassword` en cada
// endpoint destructivo.
router.post('/verify-password', authenticate, async (req, res, next) => {
  try {
    await auth.verifyPassword(req.user._id || req.user.userId, req.body?.password)
    res.status(200).json({ success:true, message:'Autorización válida' })
  } catch (error) {
    next(error)
  }
});








export default router
