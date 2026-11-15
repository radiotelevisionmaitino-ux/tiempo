const express = require('express');
const gTTS = require('gtts');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);

// Habilitar CORS para que otras páginas web puedan reproducir el MP3
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    next();
});
app.use(express.static(PUBLIC_DIR));

// Función para obtener datos meteorológicos con sistema principal y secundario (fallback)
async function obtenerDatosMeteorologicos() {
    // 1. FUENTE PRINCIPAL: El-Tiempo.net (Elche / 03065)
    try {
        console.Consultando = "Consultando fuente principal (el-tiempo.net para Elche)...";
        const res = await fetch('https://api.el-tiempo.net/json/v3/provincias/03/municipios/03065');
        if (res.ok) {
            const data = await res.json();
            // Adaptar datos de la API principal de el-tiempo.net
            const temperatura = data.temperatura_actual || data.tmax || "20";
            const stateSky = data.stateSky ? data.stateSky.description : "despejado";
            const tmax = data.temperaturas ? data.temperaturas.max : "25";
            const tmin = data.temperaturas ? data.temperaturas.min : "15";
            
            const ahora = new Date();
            const hour = ahora.getHours();
            const mins = ahora.getMinutes().toString().padStart(2, '0');
            const dateStr = ahora.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

            return `SERVICIO METEOROLÓGICO DE RADIO MAITINO. Boletín actualizado para hoy, ${dateStr}. Son las ${hour} horas y ${mins} minutos. En este momento, en Elche, los cielos se presentan con ${stateSky}. Los termómetros registran ${temperatura} grados. Las temperaturas previstas alcanzarán hoy un máximo de ${tmax} grados y un mínimo de ${tmin} grados. Es una información de la Agencia Meteorológica de Maitino.`;
        }
    } catch (error) {
        console.warn("Fallo en la fuente principal, intentando fuente secundaria...");
    }

    // 2. FUENTE SECUNDARIA (Fallback): wttr.in/Maitino
    try {
        const res2 = await fetch('https://wttr.in/Maitino?format=j1&lang=es');
        const data2 = await res2.json();
        const current = data2.current_condition[0];
        const today = data2.weather[0];

        const ahora = new Date();
        const hour = ahora.getHours();
        const mins = ahora.getMinutes().toString().padStart(2, '0');
        const dateStr = ahora.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        return `SERVICIO METEOROLÓGICO DE RADIO MAITINO. Boletín actualizado para hoy, ${dateStr}. Son las ${hour} horas y ${mins} minutos. En este momento, los cielos se presentan ${current.lang_es[0].value.toLowerCase()}s. Los termómetros registran ${current.temp_C} grados, el viento se sitúa en ${current.windspeedKmph} kilómetros por hora y la sensación térmica es de ${current.FeelsLikeC} grados. Las temperaturas alcanzarán hoy un máximo de ${today.maxtempC} y un mínimo de ${today.mintempC} grados. Es una información de la Agencia Meteorológica de Maitino.`;
    } catch (error) {
        console.error("Error también en la fuente secundaria:", error);
        return "SERVICIO METEOROLÓGICO DE RADIO MAITINO. En estos momentos no podemos actualizar los datos meteorológicos, disculpen las molestias. Continuamos con la programación habitual.";
    }
}

async function generarBoletinMP3() {
    try {
        const guionText = await obtenerDatosMeteorologicos();
        const rawVoicePath = path.join(__dirname, 'voz_temp.mp3');
        const finalMp3Path = path.join(PUBLIC_DIR, 'boletin.mp3');

        // Generar voz con Google TTS
        const gtts = new gTTS(guionText, 'es');
        await new Promise((resolve, reject) => {
            gtts.save(rawVoicePath, (err) => err ? reject(err) : resolve());
        });

        // Combinar arpegio + voz y ajustar exactamente a 60 segundos con FFmpeg
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input('sine=frequency=261.63:duration=0.4').inputFormat('lavfi')
                .input('sine=frequency=329.63:duration=0.4').inputFormat('lavfi')
                .input('sine=frequency=392.00:duration=0.4').inputFormat('lavfi')
                .input('sine=frequency=523.25:duration=0.6').inputFormat('lavfi')
                .input(rawVoicePath)
                .input('anullsrc=r=44100:cl=mono').inputFormat('lavfi')
                .complexFilter([
                    '[0:a]adelay=0|0,volume=0.15[n1]',
                    '[1:a]adelay=150|150,volume=0.15[n2]',
                    '[2:a]adelay=300|300,volume=0.15[n3]',
                    '[3:a]adelay=450|450,volume=0.15[n4]',
                    '[n1][n2][n3][n4]amix=inputs=4:duration=longest[arpegio]',
                    '[4:a]atempo=1.05[voz]',
                    '[arpegio][voz][5:a]concat=n=3:v=0:a=1[out]'
                ])
                .outputOptions([
                    '-map [out]',
                    '-t 60',              // EXACTAMENTE 60 SEGUNDOS
                    '-codec:a libmp3lame',
                    '-b:a 128k'
                ])
                .save(finalMp3Path)
                .on('end', () => {
                    if (fs.existsSync(rawVoicePath)) fs.unlinkSync(rawVoicePath);
                    actualizarHTML();
                    resolve();
                })
                .on('error', reject);
        });

        console.log(`[${new Date().toLocaleTimeString()}] boletin.mp3 generado con éxito (60s exactos).`);
    } catch (error) {
        console.error('Error en el proceso de generación del MP3:', error);
    }
}

function actualizarHTML() {
    const version = Date.now();
    const html = `<!DOCTYPE html><html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Directo | Radio Maitino</title>
    <style>
        body {
            background-color: #000;
            margin: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            font-family: sans-serif;
        }
        audio {
            width: 300px;
            outline: none;
        }
        #status {
            color: #888;
            font-size: 13px;
            margin-bottom: 20px;
            height: 15px;
        }
    </style>
</head>
<body>
    <div id="status"></div>
    <audio id="reproductor" controls autoplay src="boletin.mp3?v=${version}"></audio>
    <script>
        const player = document.getElementById('reproductor');
        // Bucle infinito: al terminar el minuto, recarga el MP3 fresco del servidor
        player.addEventListener('ended', () => {
            player.src = 'boletin.mp3?v=' + Date.now();
            player.play();
        });
    </script>
</body>
</html>`;
    fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), html);
}

// Generar al iniciar y repetir cada 15 minutos
generarBoletinMP3();
setInterval(generarBoletinMP3, 900000);

app.listen(PORT, () => {
    console.log(`Radio Maitino corriendo en http://localhost:${PORT}`);
});
