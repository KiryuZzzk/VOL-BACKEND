require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const app = express();
const os = require("os");

// ⚙️ Configuración CORS segura
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "https://soyvoluntario.cruzrojamexicana.org.mx",
  ],
  methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  allowedHeaders: ["Content-Type", "Authorization", "x-firebase-uid", "x-api-key"],
  credentials: true,
};

// 🌐 Orígenes permitidos (CORS + embebido en iframe)
const FRONTEND_ORIGINS = [
  "http://localhost:3000",
  "https://soyvoluntario.cruzrojamexicana.org.mx",
];

// 🔐 Secreto para firmar URLs del SCORM Player (ponlo en Render como env var)
const SCORM_PLAYER_SECRET =
  process.env.SCORM_PLAYER_SECRET || process.env.API_KEY || "CHANGE_ME_IN_RENDER";

function hmacSha256Hex(payload) {
  return crypto.createHmac("sha256", SCORM_PLAYER_SECRET).update(payload).digest("hex");
}

function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a || ""), "hex");
    const bb = Buffer.from(String(b || ""), "hex");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

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
const progresoDocsRoutes = require("./routes/progreso.docs.routes");
const coordinacionesRoutes = require("./routes/coordinaciones.routes");
const trayectoriaRoutes = require("./routes/trayectoria.routes");
const progresoAdminRoutes = require("./routes/progreso.admin.routes");



app.use("/users", usersRoutes);
app.use("/certificados", certificadosRoutes);
app.use("/disponibilidad", disponibilidadRoutes);
app.use("/public", publicRoutes);
app.use("/documentos", documentosRoutes);
app.use("/inscripciones", inscripcionesRoutes);
app.use("/progreso", progresoRoutes);
app.use("/progreso", progresoDocsRoutes);
app.use("/coordinaciones", coordinacionesRoutes);
app.use("/trayectoria", trayectoriaRoutes);
app.use("/progreso", progresoAdminRoutes);
app.use("/progreso/admin", progresoAdminRoutes);


// ✅ Servir SCORM montado (assets extraídos)
app.use(
  "/scorm/launch",
  express.static(path.join(os.tmpdir(), "scorm_launch"), {
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
    },
  })
);

// ✅ Wrapper SCORM (mismo origen) — expone API_1484_11 / API y embebe el SCO
app.get("/scorm/player", (req, res) => {
  const activityId = String(req.query.activityId || "").trim();
  const key = String(req.query.key || "").trim();
  const launch = String(req.query.launch || "").trim();

  // 🔒 URL firmada y con expiración corta (reduce link-sharing / enumeración)
  const expRaw = String(req.query.exp || "").trim();
  const sig = String(req.query.sig || "").trim();
  const exp = Number(expRaw);

  if (!activityId || !key || !launch || !expRaw || !sig) {
    return res.status(400).send("Missing activityId/key/launch/exp/sig");
  }
  if (!Number.isFinite(exp)) {
    return res.status(400).send("Invalid exp");
  }
  if (Date.now() > exp) {
    return res.status(403).send("Expired");
  }

  const payload = `${activityId}|${key}|${launch}|${exp}`;
  const expected = hmacSha256Hex(payload);
  if (!safeEqualHex(sig, expected)) {
    return res.status(403).send("Bad signature");
  }

  const scoSrc = `/scorm/launch/${key}/${launch}`;

  // ✅ Headers de seguridad (iframe SOLO desde tu front)
  const frameAncestors = ["'self'", ...FRONTEND_ORIGINS].join(" ");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      `frame-ancestors ${frameAncestors}`,
      "base-uri 'none'",
      "object-src 'none'",
      // Inline script/style solo para este wrapper (si quieres endurecer más: usa nonce)
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "img-src 'self' data: blob:",
      // El iframe carga SCO mismo-origen (/scorm/launch/*)
      "frame-src 'self'",
      "connect-src 'self'",
    ].join("; ")
  );
  // ❌ NO usar X-Frame-Options aquí (lo reemplaza CSP frame-ancestors)
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store, max-age=0");

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
  var ALLOWED = ${JSON.stringify(FRONTEND_ORIGINS)};

  function post(type, payload){
    try {
      if (window.parent && window.parent !== window) {
        var msg = Object.assign({ type: type, activityId: activityId }, payload || {});
        for (var i=0; i<ALLOWED.length; i++){
          window.parent.postMessage(msg, ALLOWED[i]);
        }
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

<iframe
  id="frame"
  src="${scoSrc}"
  allow="fullscreen"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
></iframe>
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
