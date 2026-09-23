/**
 * emailService — centralised outbound email for Eduzyra.
 *
 * Transport: Resend Transactional Email HTTP API (https://api.resend.com/emails).
 * We use the HTTPS API instead of raw SMTP because most PaaS hosts (Render
 * included) block outbound SMTP ports (25/465/587), which caused OTP/reset
 * emails to silently time out. The HTTPS API runs over port 443, which is
 * never blocked.
 *
 * Required env vars:
 *   RESEND_API_KEY       — from Resend → API Keys → Create API Key
 *   EMAIL_FROM_ADDRESS   — verified sender address (optional; defaults to
 *                          'onboarding@resend.dev', Resend's shared test
 *                          sender, which only delivers to the email address
 *                          used to sign up for the Resend account until a
 *                          custom domain is verified)
 *   EMAIL_FROM_NAME      — display name (optional, defaults to "Eduzyra")
 *
 * Templates: all emails use inline-styled responsive HTML (email clients strip
 * <style> tags, so styles must be inline). Each function builds its own HTML
 * string with the Eduzyra header + body + footer.
 *
 * Error handling: every function wraps the send in try/catch and logs failures
 * via console.error. Email failures NEVER throw — a failed welcome email must
 * not fail the signup response. The caller's try/catch is a second safety net.
 *
 * Amounts: all DB amounts are in paise. Divide by 100 before displaying.
 * Use formatRupees() helper below — never inline the math.
 *
 * Security: all user-supplied values (name, email, message, courseTitle) are
 * HTML-escaped via the escapeHtml() helper before interpolation into templates.
 * This prevents HTML/script injection in email clients.
 */

// ── HTML escaping helper ──────────────────────────────────────────────────
// Escapes &, <, >, ", ' to prevent HTML injection in email templates.
// Every user-supplied value MUST be passed through this before interpolation.
function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ── Resend HTTP API sender ─────────────────────────────────────────────────
// Render/most PaaS block outbound raw SMTP ports (25/465/587), so we send
// via Resend's HTTPS transactional email API instead of nodemailer + SMTP.
// Resend activates new accounts immediately (no manual review), unlike some
// other providers. Until a custom sending domain is verified in Resend, mail
// must be sent FROM 'onboarding@resend.dev' and can only be delivered TO the
// email address used to sign up for the Resend account.
const RESEND_API_URL = 'https://api.resend.com/emails'

async function sendViaResend({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured — set it in your environment variables')
  }

  const fromName = process.env.EMAIL_FROM_NAME || 'Eduzyra'
  // Use Resend's shared test sender unless a verified custom domain sender is set.
  const fromEmail = process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev'

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject,
      html,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Resend API error ${res.status}: ${errText}`)
  }

  return true
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Format paise (integer) as Indian Rupee string: 49900 → "₹499" */
function formatRupees(paise) {
  const rupees = Math.round(Number(paise) || 0) / 100
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees)
}

/** Common HTML wrapper with Eduzyra branding — header, content, footer. */
function emailWrapper(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a202c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);max-width:600px;">
          <tr>
            <td style="background-color:#12213B;padding:24px 32px;text-align:center;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">Eduzyra</span>
              <span style="font-size:11px;color:#529286;margin-left:8px;">by Althexus</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">
                You're receiving this email because you have an Eduzyra account.<br>
                If this wasn't you, please reply to this email to let us know.<br>
                <strong>Eduzyra by Althexus</strong> &middot; India
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Centralised send — wraps the Resend API call in try/catch, logs failures. */
async function send({ to, subject, html }) {
  try {
    await sendViaResend({ to, subject, html })
    return true
  } catch (err) {
    const errorMessage = err?.message || String(err)
    const isMissingKey = errorMessage.includes('RESEND_API_KEY not configured')

    if (isMissingKey && process.env.NODE_ENV !== 'production') {
      console.warn('[emailService] RESEND_API_KEY not configured. Dev fallback: email content will be logged to the console.')
      console.group('[emailService] DEV EMAIL OUTPUT')
      console.log('to:', to)
      console.log('subject:', subject)
      console.log('html:', html)
      console.groupEnd()
      return true
    }

    console.error('[emailService] Failed to send email:', {
      to,
      subject,
      error: errorMessage,
    })
    return false
  }
}

// ── Public email functions ────────────────────────────────────────────────

/**
 * Welcome email — sent on signup.
 * @param {{name: string, email: string}} args
 */
export async function sendWelcomeEmail({ name, email }) {
  const html = emailWrapper(
    'Welcome to Eduzyra',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Welcome, ${escapeHtml(name)}!</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Your Eduzyra account is ready. You can now browse courses, enroll, and start learning today.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <a href="${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/courses" style="display:inline-block;background-color:#00C2A8;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Browse Courses</a>
     </p>
     <p style="margin:24px 0 0;font-size:13px;color:#718096;">
       Happy learning!<br>The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: 'Welcome to Eduzyra', html })
}

/**
 * OTP verification email — sent on signup and on resend-otp.
 * @param {{name: string, email: string, otp: string, ttlMinutes: number}} args
 */
export async function sendOtpEmail({ name, email, otp, ttlMinutes }) {
  const html = emailWrapper(
    'Verify your Eduzyra account',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Verify your email</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, use the code below to verify your Eduzyra account and finish signing in.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <span style="display:inline-block;background-color:#EEF1F6;color:#12213B;padding:16px 32px;border-radius:8px;font-family:monospace;font-size:28px;font-weight:700;letter-spacing:8px;border:2px dashed #529286;">${escapeHtml(otp)}</span>
     </p>
     <p style="margin:16px 0 0;font-size:13px;color:#718096;">
       This code expires in ${escapeHtml(String(ttlMinutes))} minutes. If you didn't create an Eduzyra account, you can safely ignore this email.
     </p>`,
  )
  return send({ to: email, subject: `${otp} is your Eduzyra verification code`, html })
}

/**
 * Password reset email — sent on forgotPassword.
 * @param {{name: string, email: string, resetUrl: string}} args
 */
export async function sendPasswordResetEmail({ name, email, resetUrl }) {
  const html = emailWrapper(
    'Reset your Eduzyra password',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Reset your password</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, we received a request to reset your Eduzyra password. Click the button below to set a new one.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <a href="${resetUrl}" style="display:inline-block;background-color:#00C2A8;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Reset Password</a>
     </p>
     <p style="margin:16px 0 0;font-size:13px;color:#718096;">
       This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.
     </p>
     <p style="margin:16px 0 0;font-size:12px;color:#a0aec0;word-break:break-all;">
       Or copy this link: ${resetUrl}
     </p>`,
  )
  return send({ to: email, subject: 'Reset your Eduzyra password', html })
}

/**
 * Enrollment confirmation email — sent after successful enrollment.
 * @param {{name: string, email: string, courseTitle: string, courseUrl: string}} args
 */
export async function sendEnrollmentConfirmationEmail({ name, email, courseTitle, courseUrl }) {
  const html = emailWrapper(
    "You're enrolled!",
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">You're enrolled!</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, you're now enrolled in <strong style="color:#12213B;">${escapeHtml(courseTitle)}</strong>. Start learning right away.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <a href="${courseUrl}" style="display:inline-block;background-color:#00C2A8;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Start Learning</a>
     </p>
     <p style="margin:24px 0 0;font-size:13px;color:#718096;">
       Happy learning!<br>The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: `Enrolled: ${escapeHtml(courseTitle)}`, html })
}

/**
 * Payment success email — sent after payment verification.
 * @param {{name: string, email: string, courseTitle: string, amount: number, transactionId: string, receiptUrl: string}} args
 *   amount is in PAISE — divided by 100 for display.
 */
export async function sendPaymentSuccessEmail({ name, email, courseTitle, amount, transactionId, receiptUrl }) {
  const formattedAmount = formatRupees(amount)
  const html = emailWrapper(
    'Payment successful',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Payment successful</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, your payment of <strong style="color:#12213B;">${formattedAmount}</strong> for <strong style="color:#12213B;">${escapeHtml(courseTitle)}</strong> was received.
     </p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border-radius:8px;padding:16px;">
       <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Transaction ID</td><td style="font-size:13px;color:#12213B;font-weight:600;padding:4px 0;text-align:right;font-family:monospace;">${escapeHtml(transactionId)}</td></tr>
       <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Amount</td><td style="font-size:13px;color:#12213B;font-weight:600;padding:4px 0;text-align:right;">${formattedAmount}</td></tr>
     </table>
     <p style="margin:24px 0;text-align:center;">
       <a href="${receiptUrl}" style="display:inline-block;background-color:#00C2A8;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Download Receipt</a>
     </p>
     <p style="margin:24px 0 0;font-size:13px;color:#718096;">
       Thanks for your purchase!<br>The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: `Payment receipt — ${escapeHtml(courseTitle)}`, html })
}

/**
 * Refund email — sent after a refund is processed.
 * @param {{name: string, email: string, courseTitle: string, amount: number, refundId: string}} args
 *   amount is in PAISE.
 */
export async function sendRefundEmail({ name, email, courseTitle, amount, refundId }) {
  const formattedAmount = formatRupees(amount)
  const html = emailWrapper(
    'Refund processed',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Refund processed</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, a refund of <strong style="color:#12213B;">${formattedAmount}</strong> for <strong style="color:#12213B;">${escapeHtml(courseTitle)}</strong> has been processed.
     </p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border-radius:8px;padding:16px;">
       <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Refund ID</td><td style="font-size:13px;color:#12213B;font-weight:600;padding:4px 0;text-align:right;font-family:monospace;">${escapeHtml(refundId)}</td></tr>
       <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Amount</td><td style="font-size:13px;color:#12213B;font-weight:600;padding:4px 0;text-align:right;">${formattedAmount}</td></tr>
     </table>
     <p style="margin:16px 0 0;font-size:13px;color:#718096;">
       The refund will appear in your account within 5-7 business days.<br>The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: `Refund processed — ${escapeHtml(courseTitle)}`, html })
}

/**
 * Certificate email — sent when a certificate is issued.
 * @param {{name: string, email: string, courseTitle: string, certificateUrl: string, certificateId: string}} args
 */
export async function sendCertificateEmail({ name, email, courseTitle, certificateUrl, certificateId }) {
  const html = emailWrapper(
    'Your certificate is ready!',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Your certificate is ready!</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, congratulations on completing <strong style="color:#12213B;">${escapeHtml(courseTitle)}</strong>! Your certificate of completion is ready to download.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <a href="${certificateUrl}" style="display:inline-block;background-color:#00C2A8;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">View Certificate</a>
     </p>
     <p style="margin:16px 0 0;font-size:12px;color:#a0aec0;">
       Certificate ID: <span style="font-family:monospace;">${escapeHtml(certificateId)}</span>
     </p>
     <p style="margin:16px 0 0;font-size:13px;color:#718096;">
       Well done!<br>The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: `Certificate — ${escapeHtml(courseTitle)}`, html })
}

/**
 * Coupon email — sent when a coupon is created (admin-side, optional).
 * @param {{name: string, email: string, couponCode: string, discount: string, expiresAt: string}} args
 */
export async function sendCouponEmail({ name, email, couponCode, discount, expiresAt }) {
  const html = emailWrapper(
    'A special offer just for you',
    `<h1 style="margin:0 0 16px;font-size:24px;color:#12213B;">Special offer</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5568;">
       Hi ${escapeHtml(name)}, here's a coupon just for you: <strong style="color:#12213B;">${escapeHtml(discount)}</strong> off your next enrollment.
     </p>
     <p style="margin:24px 0;text-align:center;">
       <span style="display:inline-block;background-color:#EEF1F6;color:#12213B;padding:16px 32px;border-radius:8px;font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;border:2px dashed #529286;">${escapeHtml(couponCode)}</span>
     </p>
     ${expiresAt ? `<p style="margin:16px 0 0;font-size:13px;color:#718096;">Expires on ${expiresAt}.</p>` : ''}
     <p style="margin:24px 0 0;font-size:13px;color:#718096;">
       The Eduzyra Team
     </p>`,
  )
  return send({ to: email, subject: `Coupon: ${escapeHtml(couponCode)}`, html })
}

/**
 * Contact form email — sent to the platform admin's FROM address.
 * @param {{name: string, email: string, message: string}} args
 */
export async function sendContactEmail({ name, email, message }) {
  const html = emailWrapper(
    'New contact form submission',
    `<h2 style="margin:0 0 16px;font-size:20px;color:#12213B;">New message from ${escapeHtml(name)}</h2>
     <p style="margin:0 0 8px;font-size:13px;color:#64748b;">From: <strong style="color:#12213B;">${escapeHtml(email)}</strong></p>
     <p style="margin:16px 0 8px;font-size:14px;color:#1a202c;white-space:pre-wrap;">${escapeHtml(message)}</p>`
  )
  const adminEmail = process.env.EMAIL_FROM_ADDRESS || 'noreply@eduzyra.dev'
  return send({ to: adminEmail, subject: `Contact: ${escapeHtml(name)}`, html })
}
