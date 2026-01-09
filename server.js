// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const app = express();
const os = require("os");

// ⚙️ Configuración CORS segura
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "https://soyvoluntario.cruzrojamexicana.org.mx"
  ],
  methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-firebase-uid",
    "x-api-key"
  ],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// 🔐 API Key opcional (si deseas bloquear algunas rutas internas)
const API_KEY = process.env.API_KEY || "supersecreto";
const authApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== API_KEY) {
    return res.status(403).json({ error: "Acceso no autorizado" });
  }
  next();
};

// 🧠 Base de datos
const db = require("./config/db");

// 📦 Rutas
const usersRoutes = require("./routes/users.routes");
const certificadosRoutes = require("./routes/certificados.routes");
const disponibilidadRoutes = require("./routes/disponibilidad.routes");
const publicRoutes = require("./routes/public.routes");
const documentosRoutes = require("./routes/documentos.routes");
const inscripcionesRoutes = require("./routes/inscripciones.routes");
const progresoRoutes = require("./routes/progreso.routes");

app.use("/users", usersRoutes);
app.use("/certificados", certificadosRoutes);
app.use("/disponibilidad", disponibilidadRoutes);
app.use("/public", publicRoutes);
app.use("/documentos", documentosRoutes);
app.use("/inscripciones", inscripcionesRoutes);
app.use("/progreso", progresoRoutes);

// ✅ Servir SCORM montado
app.use("/scorm/launch", express.static(path.join(os.tmpdir(), "scorm_launch")));

// ✅ Wrapper SCORM (mismo origen) — expone API_1484_11 / API y embebe el SCO
app.get("/scorm/player", (req, res) => {
  const activityId = String(req.query.activityId || "").trim();
  const key = String(req.query.key || "").trim();
  const launch = String(req.query.launch || "").trim();

  if (!key || !launch) {
    return res.status(400).send("Missing key/launch");
  }

  const scoSrc = `/scorm/launch/${key}/${launch}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  return res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SCORM Player</title>
  <style>
    html, body { margin:0; padding:0; height:100%; background:#000; }
    #frame { width:100%; height:100%; border:0; display:block; }
  </style>
</head>
<body>
<script>
(function(){
  var activityId = ${JSON.stringify(activityId)};
  var cmi = {};

  function post(type, payload){
    try {
      if (window.parent && window.parent !== window) {
        // Intento estricto (prod)
        window.parent.postMessage(Object.assign({ type: type, activityId: activityId }, payload || {}), "https://soyvoluntario.cruzrojamexicana.org.mx");
        // Fallback dev / ambientes alternos
        window.parent.postMessage(Object.assign({ type: type, activityId: activityId }, payload || {}), "*");
      }
    } catch(e){}
  }

  // ===== SCORM 2004 =====
  window.API_1484_11 = {
    Initialize: function(){ post("SCORM_INIT"); return "true"; },
    Terminate: function(){ post("SCORM_COMMIT", { cmi: cmi, raw: { event:"Terminate" } }); return "true"; },
    GetValue: function(k){ return (cmi[k] !== undefined && cmi[k] !== null) ? String(cmi[k]) : ""; },
    SetValue: function(k,v){ cmi[k] = String(v); return "true"; },
    Commit: function(){ post("SCORM_COMMIT", { cmi: cmi, raw: { event:"Commit" } }); return "true"; },
    GetLastError: function(){ return "0"; },
    GetErrorString: function(){ return ""; },
    GetDiagnostic: function(){ return ""; }
  };

  // ===== SCORM 1.2 (fallback) =====
  window.API = {
    LMSInitialize: function(){ post("SCORM_INIT"); return "true"; },
    LMSFinish: function(){ post("SCORM_COMMIT", { cmi: cmi, raw: { event:"LMSFinish" } }); return "true"; },
    LMSGetValue: function(k){ return (cmi[k] !== undefined && cmi[k] !== null) ? String(cmi[k]) : ""; },
    LMSSetValue: function(k,v){ cmi[k] = String(v); return "true"; },
    LMSCommit: function(){ post("SCORM_COMMIT", { cmi: cmi, raw: { event:"LMSCommit" } }); return "true"; },
    LMSGetLastError: function(){ return "0"; },
    LMSGetErrorString: function(){ return ""; },
    LMSGetDiagnostic: function(){ return ""; }
  };
})();
</script>

<iframe id="frame" src="${scoSrc}" allow="fullscreen" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe>
</body>
</html>`);
});

// Ruta raíz
app.get("/", (req, res) => {
  res.send("✨ API de SoyVoluntario corriendo correctamente ✨");
});

// 🚀 Levantar servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
