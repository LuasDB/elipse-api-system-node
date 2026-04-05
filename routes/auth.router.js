import express from 'express'
import Auth from './../services/auth.service.js'

const router = express.Router()
const auth = new Auth()

router.post('/register',async(req, res, next)=>{
  try {
    const newRegister = await auth.create(req.body)
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
    const token = await auth.login(req.body)
    if(token){
      res.status(200).json({
        success:true,message:'Acceso',token
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








export default router
