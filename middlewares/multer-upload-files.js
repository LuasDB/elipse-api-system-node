import upload from './../configurations/multer-config.js'
const uploadFiles = (req,res,next)=>{
  const { collection } = req.params
  req.upload = upload(collection)
  next()
}

export default uploadFiles
