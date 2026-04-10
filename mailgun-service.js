// =====================================================
// 📧 SERVICIO DE EMAILS CON MAILGUN
// =====================================================

const Mailgun = require("mailgun.js");
const FormData = require("form-data");

let mailgunClient = null;

// Inicializar Mailgun
function initMailgun() {
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
    console.warn("⚠️ Mailgun no configurado. Los emails no se enviarán.");
    console.warn("   Variables requeridas: MAILGUN_API_KEY, MAILGUN_DOMAIN");
    return null;
  }

  try {
    const mailgun = new Mailgun(FormData);
    mailgunClient = mailgun.client({
      username: "api",
      key: process.env.MAILGUN_API_KEY,
    });
    console.log("✅ Mailgun inicializado correctamente");
    return mailgunClient;
  } catch (err) {
    console.error("❌ Error inicializando Mailgun:", err.message);
    return null;
  }
}

// =====================================================
// 📧 ENVIAR EMAIL DE NUEVA VOTACIÓN
// =====================================================
async function sendPollNotification(
  playerEmail,
  playerName,
  pollTitle,
  pollOptions,
) {
  if (!mailgunClient) {
    console.warn(
      `⚠️ Email no enviado a ${playerEmail} (Mailgun no configurado)`,
    );
    return false;
  }

  try {
    // Construir lista de opciones de partidos
    const optionsList = pollOptions
      .map(
        (opt, idx) =>
          `${idx + 1}. ${opt.home_team_name} vs ${opt.away_team_name}`,
      )
      .join("<br>");

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">⚽ PorraPLUS ELITE</h1>
        </div>
        
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <h2 style="color: #667eea; margin-top: 0;">¡Hola ${playerName}!</h2>
          
          <p style="font-size: 16px; line-height: 1.6;">
            Se ha abierto una nueva votación para decidir el próximo partido de la semana.
          </p>
          
          <div style="background: white; padding: 20px; border-left: 4px solid #667eea; margin: 20px 0; border-radius: 4px;">
            <h3 style="margin-top: 0; color: #667eea;">${pollTitle}</h3>
            <div style="color: #555; font-size: 14px;">
              ${optionsList}
            </div>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.APP_URL || "https://tuapp.com"}" 
               style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                      color: white; 
                      padding: 12px 30px; 
                      text-decoration: none; 
                      border-radius: 6px; 
                      font-weight: bold;
                      display: inline-block;">
              🗳️ Ir a votar
            </a>
          </div>
          
          <p style="font-size: 12px; color: #999; text-align: center; margin-top: 30px;">
            Este es un email automatizado. No respondas a este mensaje.
          </p>
        </div>
      </div>
    `;

    const textContent = `
¡Hola ${playerName}!

Se ha abierto una nueva votación para decidir el próximo partido de la semana.

${pollTitle}

Opciones:
${pollOptions.map((opt, idx) => `${idx + 1}. ${opt.home_team_name} vs ${opt.away_team_name}`).join("\n")}

Ve a votar en: ${process.env.APP_URL || "https://tuapp.com"}
    `;

    await mailgunClient.messages.create(process.env.MAILGUN_DOMAIN, {
      from: `PorraPLUS ELITE <noreply@${process.env.MAILGUN_DOMAIN}>`,
      to: playerEmail,
      subject: `🗳️ ${pollTitle}`,
      html: htmlContent,
      text: textContent,
    });

    console.log(`✅ Email de votación enviado a ${playerEmail}`);
    return true;
  } catch (err) {
    console.error(
      `❌ Error enviando email de votación a ${playerEmail}:`,
      err.message,
    );
    return false;
  }
}

// =====================================================
// 📧 ENVIAR EMAIL DE TURNO
// =====================================================
async function sendTurnNotification(
  playerEmail,
  playerName,
  matchInfo,
  homeTeam,
  awayTeam,
) {
  if (!mailgunClient) {
    console.warn(
      `⚠️ Email no enviado a ${playerEmail} (Mailgun no configurado)`,
    );
    return false;
  }

  try {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">⚽ PorraPLUS ELITE</h1>
        </div>
        
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
            <h2 style="color: white; margin: 0; font-size: 28px;">⚽ ¡ES TU TURNO!</h2>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">
              ${playerName}, es tu momento de brillar
            </p>
          </div>
          
          <p style="font-size: 16px; line-height: 1.6; color: #555;">
            Toca que hagas tu predicción en el siguiente partido:
          </p>
          
          <div style="background: white; padding: 25px; border-left: 6px solid #f5576c; margin: 20px 0; border-radius: 4px; text-align: center;">
            <div style="font-size: 28px; font-weight: bold; color: #667eea; margin-bottom: 10px;">
              ${homeTeam}
              <span style="color: #f5576c; font-size: 20px;">vs</span>
              ${awayTeam}
            </div>
            <p style="color: #999; margin: 0; font-size: 14px;">
              ${matchInfo}
            </p>
          </div>
          
          <div style="background: #e7f5ff; padding: 18px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #667eea;">
            <p style="margin: 0; color: #0052cc; font-size: 15px;">
              <strong>💡 ¿Qué debes hacer?</strong><br>
              Predice el marcador exacto del partido. Ejemplo: <strong>2-1</strong>, <strong>0-0</strong>, <strong>3-2</strong>, etc.
            </p>
          </div>
          
          <div style="background: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0; color: #856404; font-size: 14px;">
              <strong>⏰ Nota:</strong> Completa tu apuesta cuando puedas. Los demás jugadores están esperando.
            </p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.APP_URL || "https://tuapp.com"}" 
               style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                      color: white; 
                      padding: 14px 40px; 
                      text-decoration: none; 
                      border-radius: 6px; 
                      font-weight: bold;
                      display: inline-block;
                      font-size: 16px;
                      transition: transform 0.2s;">
              ⚽ Ir a apostar ahora
            </a>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="font-size: 13px; color: #999; text-align: center; margin: 0;">
              PorraPLUS ELITE • Tu quiniela semanal<br>
              Este es un email automatizado. No respondas a este mensaje.
            </p>
          </div>
        </div>
      </div>
    `;

    const textContent = `
¡${playerName}, ES TU TURNO!

Es tu momento de hacer tu predicción en el siguiente partido:

${homeTeam} vs ${awayTeam}
${matchInfo}

¿Qué debes hacer?
Predice el marcador exacto del partido. Ejemplo: 2-1, 0-0, 3-2, etc.

Nota: Completa tu apuesta cuando puedas. Los demás jugadores están esperando.

Ve a apostar en: ${process.env.APP_URL || "https://tuapp.com"}

---
PorraPLUS ELITE • Tu quiniela semanal
    `;

    await mailgunClient.messages.create(process.env.MAILGUN_DOMAIN, {
      from: `PorraPLUS ELITE <noreply@${process.env.MAILGUN_DOMAIN}>`,
      to: playerEmail,
      subject: `⚽ ¡${playerName}, ES TU TURNO! - ${homeTeam} vs ${awayTeam}`,
      html: htmlContent,
      text: textContent,
    });

    console.log(`✅ Email de turno enviado a ${playerEmail}`);
    return true;
  } catch (err) {
    console.error(
      `❌ Error enviando email de turno a ${playerEmail}:`,
      err.message,
    );
    return false;
  }
}

// =====================================================
// 📧 ENVIAR EMAILS A MÚLTIPLES JUGADORES
// =====================================================
async function sendPollToActivePlayers(pool, pollTitle, pollOptions) {
  if (!mailgunClient) {
    console.warn("⚠️ Emails de votación no enviados (Mailgun no configurado)");
    return { sent: 0, failed: 0 };
  }

  try {
    // Obtener jugadores activos con email
    const { rows: players } = await pool.query(`
      SELECT id, name, email 
      FROM players 
      WHERE active = 1 AND email IS NOT NULL AND email != ''
      ORDER BY order_position
    `);

    let sent = 0;
    let failed = 0;

    // Enviar email a cada jugador
    for (const player of players) {
      const success = await sendPollNotification(
        player.email,
        player.name,
        pollTitle,
        pollOptions,
      );
      if (success) {
        sent++;
      } else {
        failed++;
      }
      // Pequeño delay para evitar rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`📊 Emails de votación: ${sent} enviados, ${failed} fallidos`);
    return { sent, failed };
  } catch (err) {
    console.error("❌ Error enviando emails de votación:", err.message);
    return { sent: 0, failed: 0 };
  }
}

async function sendTurnToPlayer(pool, playerId, matchInfo, homeTeam, awayTeam) {
  if (!mailgunClient) {
    console.warn(
      `⚠️ Email de turno no enviado para jugador ${playerId} (Mailgun no configurado)`,
    );
    return false;
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT name, email 
      FROM players 
      WHERE id = $1 AND active = 1
    `,
      [playerId],
    );

    if (rows.length === 0) {
      console.warn(`⚠️ Jugador ${playerId} no encontrado o inactivo`);
      return false;
    }

    const player = rows[0];

    if (!player.email) {
      console.warn(`⚠️ Jugador ${player.name} no tiene email registrado`);
      return false;
    }

    return await sendTurnNotification(
      player.email,
      player.name,
      matchInfo,
      homeTeam,
      awayTeam,
    );
  } catch (err) {
    console.error(
      `❌ Error enviando email de turno al jugador ${playerId}:`,
      err.message,
    );
    return false;
  }
}

module.exports = {
  initMailgun,
  sendPollNotification,
  sendTurnNotification,
  sendPollToActivePlayers,
  sendTurnToPlayer,
};
