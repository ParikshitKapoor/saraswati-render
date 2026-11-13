/**
 * Traccar SMS Gateway (Android SMS Gateway API) Integration
 *
 * Sends SMS via an Android device running Traccar SMS Gateway or a Traccar server.
 * Standard endpoint expects:
 *   POST process.env.SMS_GATEWAY_URL (default: https://traccar.org)
 *   Headers:
 *     Authorization: process.env.SMS_GATEWAY_TOKEN
 *     Content-Type: application/json
 *   Body:
 *     { "to": phoneNumber, "message": "Your password reset OTP is: XXXXXX. Valid for 5 minutes." }
 */

export async function sendTraccarSms(phoneNumber, otp) {
  let rawUrl = (process.env.SMS_GATEWAY_URL || 'https://www.traccar.org/sms/').trim();
  if (rawUrl === 'https://traccar.org' || rawUrl === 'https://www.traccar.org') {
    rawUrl = 'https://www.traccar.org/sms/';
  } else if (!rawUrl.endsWith('/') && !rawUrl.includes('?')) {
    rawUrl = rawUrl + '/';
  }
  const gatewayUrl = rawUrl;
  const token = process.env.SMS_GATEWAY_TOKEN?.trim();
  const message = `Your password reset OTP is: ${otp}. Valid for 5 minutes.`;

  console.log(`\n============================================================`);
  console.log(`[TRACCAR SMS GATEWAY] 📱 Password Reset OTP Dispatch`);
  console.log(`[DESTINATION] : ${phoneNumber}`);
  console.log(`[GATEWAY URL] : ${gatewayUrl}`);
  console.log(`[TOKEN SET]   : ${token ? 'YES' : 'NO (Terminal Simulation Active)'}`);
  console.log(`[OTP CODE]    : >>> ${otp} <<<`);
  console.log(`[EXPIRES IN]  : 5 minutes`);
  console.log(`[TIMESTAMP]   : ${new Date().toISOString()}`);
  console.log(`============================================================\n`);

  if (!token) {
    console.warn('[Traccar SMS Gateway] SMS_GATEWAY_TOKEN not configured in .env. Falling back to local terminal simulated dispatch.');
    return {
      success: true,
      simulated: true,
      message: 'OTP logged to server console (SMS_GATEWAY_TOKEN not configured)',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
      },
      body: JSON.stringify({
        to: phoneNumber,
        message,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseText = await response.text();
    let responseData = null;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { text: responseText };
    }

    if (!response.ok) {
      console.error(`[Traccar SMS Gateway Error] HTTP ${response.status}:`, responseData);
      throw new Error(`SMS Gateway responded with status ${response.status}`);
    }

    console.log('[Traccar SMS Gateway] SMS dispatched successfully:', responseData);
    return {
      success: true,
      simulated: false,
      data: responseData,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.error('[Traccar SMS Gateway Error] Request timed out after 10s');
      throw new Error('SMS Gateway connection timed out');
    }
    console.error('[Traccar SMS Gateway Error]:', err.message);
    throw err;
  }
}

