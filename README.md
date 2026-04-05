# 🛠️ Machote de API REST con Node.js + Express
Este repositorio es una plantilla que servira como base para crear APIs REST modernas con Node.js
---

## 🚀 Características principales

- 🔧 Framework: [Express](https://expressjs.com/)
- 🧠 Sintaxis moderna con ES Modules (`type: "module"`)
- 📡 WebSockets con [Socket.IO](https://socket.io/)
- ✉️ Envío de correos usando [Nodemailer](https://nodemailer.com/) + [Handlebars](https://handlebarsjs.com/) para plantillas HTML
- 🔒 Autenticación JWT con [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)
- 💾 Base de datos: [MongoDB](https://www.mongodb.com/) usando [mongodb](https://www.mongodb.com/docs/drivers/node/current/)
- 📁 Subida de archivos con [Multer](https://github.com/expressjs/multer)
- ⚠️ Manejo de errores elegante con [Boom](https://github.com/hapijs/boom)
- 📂 Arquitectura modular y organizada para proyectos a mediano y largo plazo

---

## 📦 Instalación

1. Clona este repositorio:

```bash
git clone https://github.com/LuasDB/api-machote-node.git
cd pi-machote-node
```

2. Instala las dependencias:

```bash
npm install
```

3. Crea un archivo .env basado en .env.example:

```bash
cp .env.example .env

```
4. Configura las variables de entorno en tu archivo .env (puesto, MongoDB,JWT, etc):

```bash
# Puerto en el que se ejecuta el servidor
PORT=3000

# URL base del servidor (usado internamente para desarrollo)
SERVER=http://localhost:3000

# URL de la aplicación cliente (por ejemplo, frontend con react)
URL_APP=http://localhost:5673

# Cadena de conexión a MongoDB
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
MONGO_DATABASE=apiMachote

# Clave secreta para generación y verificación de JWT
JWT_SECRET=your_jwt_secret_here

# Configuración para envío de correos
SERVICE_EMAIL=gmail
EMAIL_SUPPORT=your_email@example.com
PASS_SUPPORT=your_app_password_here


```


> **⚠️ Notas importantes**
>- Reemplaza < user > , < password > y < cluster > con los datos reales de tu cuenta de MongoDB Atlas.
>- PASS_SUPPORT es la contraseña de aplicación que genera Gmail, no tu contraseña personal.
>- Nunca subas el archivo .env real a GitHub. asegurate de que se añada .env en tu archivo .gitignore



5. Scripts disponibles:

```bash
# Iniciar el servidor en modo desarrollo con recarga automática usando nodemon
npm run dev

# Iniciar en modo producción
npm start

```
## 🧰Estructura del Proyecto
```bash
📦src
 ┣ 📂configurations         # Configuraciones generales (por ejemplo, Multer para archivos)
 ┣ 📂db                     # Conexión y configuración de la base de datos MongoDB
 ┣ 📂emails                 # Plantillas HTML con extensión .hbs para el envío de correos
 ┣ 📂middlewares            # Middlewares personalizados para validación, autenticación, etc.
 ┣ 📂routes                 # Rutas de la API, organizadas por funcionalidad o servicio
 ┣ 📂services               # Lógica de negocio principal consumida por las rutas
 ┣ 📂uploads                # Carpeta para subir y servir archivos estáticos
 ┣ 📂utils                  # Funciones reutilizables y utilidades generales
 ┣ 🗒️.editorconfig          # Configuración estándar para editores de texto
 ┣ 🗒️.env                   # Variables de entorno (no debe subirse al repositorio)
 ┣ 🗒️.eslintrc.json         # Configuración de reglas de estilo de código con ESLint
 ┣ 🗒️.gitignore             # Archivos y carpetas que Git debe ignorar
 ┣ 🗒️api_documentation_swaggerUi.json # Documentación de la API en formato Swagger
 ┣ 🗒️config.js              # Exporta todas las variables de entorno en un solo objeto
 ┣ 🗒️package-lock.json      # Control de versiones exactas de los paquetes instalados
 ┣ 🗒️package.json           # Dependencias, scripts y metadatos del proyecto
 ┣ 📜server.js              # Archivo principal que levanta el servidor Express
 ┗ 🗒️testClient.js          # Script para probar WebSockets como cliente usando socket.io

```
