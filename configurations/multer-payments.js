import multer from 'multer'
import path from 'path'
import fs from 'fs'

const paymentStorage = (paymentId) => {
  const uploadPath = `uploads/payments/${paymentId}`
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true })
  }

  return multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadPath)
    },
    filename: (req, file, cb) => {
      const timestamp = Date.now() + '_' + Math.round(Math.random() * 1E9)
      const ext = path.extname(file.originalname)
      const safeName = file.originalname
        .replace(ext, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .substring(0, 50)
      cb(null, `${safeName}_${timestamp}${ext}`)
    }
  })
}

const uploadPaymentFiles = (paymentId) => {
  return multer({
    storage: paymentStorage(paymentId),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowedTypes = [
        'application/pdf',
        'image/jpeg', 'image/png', 'image/webp', 'image/gif'
      ]
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true)
      } else {
        cb(new Error('Solo se permiten archivos PDF e imágenes (JPG, PNG, WebP)'))
      }
    }
  })
}

export default uploadPaymentFiles