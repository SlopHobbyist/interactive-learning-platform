# Email

An instance uses two addresses:

| Address | Setting | What it is for |
|---|---|---|
| `no-reply@example.com` | `ILP_MAIL_FROM` | Outgoing only. Kratos sends sign-up confirmation codes and password recovery codes from it. |
| `help@example.com` | `ILP_HELP_EMAIL` | Incoming only. Learners write to it to reach a person. The app shows it on the sign-in, recovery, confirm-email and account pages, and every automated email carries it as `Reply-To`, so replying to a code email reaches you too. |

The app never runs a mail server. Outgoing mail goes through an **SMTP relay** (a sending
service), and `help@` goes through **Cloudflare Email Routing**, which forwards it to an inbox
you already read. Running your own mail server is possible, but it means opening port 25 (which
most home ISPs and many cloud hosts block), keeping your IP off blocklists, and exposing the
server's IP behind Cloudflare. Mail from a new server also tends to land in spam for weeks.

## Default: Mailpit (local only)

While `ILP_SMTP_URL` is unset, `docker compose up` starts **Mailpit**, a dummy mail server that
catches every email and shows it at <http://localhost:8025>. Its page is published on this
machine's loopback only, because it holds every recovery code. Nothing reaches a real inbox.

## Outgoing: an SMTP relay

1. **Pick a relay** and add your domain to it. Common ones:

   | Relay | Host | Port | Username | Password |
   |---|---|---|---|---|
   | Resend | `smtp.resend.com` | 465 | `resend` | an API key |
   | Amazon SES | `email-smtp.<region>.amazonaws.com` | 465 | SES SMTP username | SES SMTP password (not your IAM keys) |
   | Brevo | `smtp-relay.brevo.com` | 587 | your SMTP login | an SMTP key |
   | Postmark | `smtp.postmarkapp.com` | 587 | a server API token | the same token |

2. **Add the DNS records the relay shows you** (in Cloudflare: your domain, **DNS, Records**).
   They prove the mail is yours, which keeps it out of spam folders:
   - **DKIM**: one or more TXT or CNAME records that sign your mail. Add them exactly as given.
   - **SPF**: a TXT record on the domain, such as `v=spf1 include:amazonses.com ~all`. A domain
     can have only **one** SPF record, so merge `include:`s into it. With Email Routing (below)
     it looks like `v=spf1 include:_spf.mx.cloudflare.net include:<relay's> ~all`. Some relays
     send from a subdomain (e.g. `send.example.com`) and give you its own SPF and MX records;
     add those as they are.
   - **DMARC**: a TXT record named `_dmarc` with `v=DMARC1; p=none; rua=mailto:help@example.com`.
     Once reports show everything passing, raise `p=none` to `p=quarantine`.

   DNS-only (grey cloud) is right for all of these; Cloudflare doesn't proxy mail.

3. **Set `.env`** (it is gitignored; the password never goes in a tracked file):

   ```sh
   ILP_SMTP_URL=smtps://resend:re_123abc@smtp.resend.com:465/
   ILP_MAIL_FROM=no-reply@example.com
   ILP_MAIL_FROM_NAME=MidnightCrammer
   ILP_HELP_EMAIL=help@example.com
   ```

   `ILP_SMTP_URL` is a URL:
   - `smtps://user:password@host:465/` encrypts from the start (port 465).
   - `smtp://user:password@host:587/` upgrades with STARTTLS (port 587). Kratos insists on the
     upgrade; never add `?disable_starttls=true` for a real relay.
   - Percent-encode special characters in the username and password: `@` is `%40`, `:` is `%3A`,
     `/` is `%2F`, `#` is `%23`, `?` is `%3F`, `%` is `%25`.

4. **Restart.** With `ILP_SMTP_URL` set, Mailpit is no longer started, but a copy that is
   already running stays up until you remove it:

   ```sh
   docker compose up -d
   docker compose rm -sf mailpit
   ```

5. **Test it.** Create an account with an address you can read. The confirmation code should
   arrive within seconds. In Gmail, **Show original** should say `SPF: PASS`, `DKIM: PASS` and
   `DMARC: PASS`. If nothing arrives, see Troubleshooting.

## Incoming: help@ with Cloudflare Email Routing

Email Routing is free, needs the domain on Cloudflare (it is if you followed
[HTTPS.md](HTTPS.md)'s Cloudflare setup), and forwards mail to any inbox.

> If this domain already receives mail somewhere else (Google Workspace, Fastmail…), skip this
> section: enabling Email Routing replaces the domain's MX records. Create `help@` there instead.

1. Cloudflare dashboard, your domain, **Email, Email Routing**, **Get started**. Let it add its
   MX and SPF records (merge the SPF into one record as in step 2 above).
2. **Destination addresses, Add**: the inbox you read. Click the link in the email Cloudflare
   sends there.
3. **Routing rules, Create address**: custom address `help`, action **Send to an email**,
   destination that inbox.
4. Leave `no-reply@` without a rule. Mail to it bounces, which is what "no-reply" promises.

**Replying as help@.** Forwarded mail arrives in your own inbox, and a plain reply would come
from your personal address. To answer as `help@`, add it as a sending identity in your mail app
(Gmail: **Settings, Accounts, Send mail as, Add another email address**) with your relay's SMTP
host and credentials, and pick it when you reply. The reply then leaves through the relay and
passes SPF and DKIM like the code emails. Check that your relay's terms allow a little personal
mail; most transactional relays do at low volume.

## What learners see

- **Sign-up** mails a six-digit code. After saving their password, the learner enters the code
  on `/verify`, or follows the email's link, or picks **Do this later**.
- **Account page**: an unconfirmed address shows a **Confirm email** button. When
  `ILP_HELP_EMAIL` is set, a **Help** section links to it.
- **Unconfirmed learners can still sign in.** To require confirmation first, add Kratos's
  `require_verified_address` login hook (the comment above `verification:` in
  `deploy/kratos/kratos.yml` shows where).
- **Recovery** codes go to the account's address whether it is confirmed or not.

## Troubleshooting

- `docker compose logs kratos | grep -i courier` shows each send attempt and why it failed
  (wrong password, TLS trouble, a refused sender). Kratos retries a failed message a few times,
  then drops it.
- **Authentication failed**: check the percent-encoding in `ILP_SMTP_URL`, and for SES make
  sure you used SMTP credentials, not IAM access keys.
- **Timeouts**: some hosts block outgoing mail ports. 465 and 587 are rarely blocked (25 often
  is). Try the relay's other port.
- **Lands in spam**: one of SPF, DKIM or DMARC is not passing; **Show original** says which.
  Also make sure `ILP_MAIL_FROM` is on the domain you verified with the relay.
- **`help@` mail not arriving**: in Email Routing, check that the destination address is
  verified and look at **Activity log**.
