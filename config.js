import 'dotenv/config'

export default {
  port:process.env.PORT || 3000,
  server:process.env.SERVER,
  mongoURI:process.env.MONGO_URI,
  database:process.env.MONGO_DATABASE,
  jwtSecret:process.env.JWT_SECRET,
  serviceEmail:process.env.SERVICE_EMAIL,
  emailSupport:process.env.EMAIL_SUPPORT,
  passSupport:process.env.PASS_SUPPORT,
  urlApp:process.env.URL_APP
}
