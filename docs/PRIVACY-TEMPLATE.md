# Privacy notice template for self-hosted ApniHealth

This is a **template**, not legal advice. If you run ApniHealth only for yourself and your family at home, the
GDPR "household exemption" may apply and you may not need a formal notice. If you let other people sign up
(`SIGNUP_MODE=open`), you are a data controller for very sensitive data (health data is a "special category"
under GDPR Art. 9). Adapt the text below, have it checked if in doubt, publish it (for example as a static page),
and set `PRIVACY_URL` so the in-app health-data notice links to it.

Replace everything in `[brackets]`. Delete sections that do not apply.

---

## Privacy notice for [instance name, e.g. "Example Family Health"]

Last updated: [date]

### Who is responsible

[Your name or organisation], [postal address], [contact email].
[Data protection officer, if you have one: name and contact.]

### What this service is

[Instance name] runs ApniHealth, open-source software for keeping a household's health records. It is **not
medical advice and not a medical device**. It does not diagnose, treat or monitor any condition. In an
emergency, call your local emergency number.

### What data we process

- **Account data:** your email address, optional display name, sign-in sessions, passkey public keys (no
  biometric data ever leaves your device), and the date and version of the health-data notice you accepted.
- **Health data you enter or sync:** measurements (for example weight, sleep, steps, heart rate), episodes and
  symptoms, medicines, appointments, lab results and documents you upload. This can include data about other
  people in your household, such as children.
- **Technical data:** server logs with IP addresses and request paths, kept for [N days] for security.
- **Push notification subscriptions** for devices on which you turn notifications on.

- **Lab reports you choose to read in the app** are read on your device (in your browser). Only the values you
  confirm are saved; the text read from the report is not sent to us or to anyone else.

### Why, and on what legal basis

- To provide the service you signed up for (GDPR Art. 6(1)(b)).
- Health data is processed only with your **explicit consent** (GDPR Art. 9(2)(a)), which you give in the app
  before entering any health information. The app records when you consented and to which version of the notice.
- Security logs: our legitimate interest in keeping the service safe (Art. 6(1)(f)).

When you enter data about another person (for example your child), you confirm that you are allowed to do so
(for example as their parent or guardian, or with their consent).

### Who can see your data

- People you invite to your household, according to the role you give them (owner, editor, viewer).
- [Hosting provider, e.g. "Example Hosting GmbH, Germany", as processor under a data processing agreement.]
- [Email provider used to send sign-in links, e.g. "Example Mail Ltd", which sees your email address.]
- [Push services (Apple, Google, Mozilla) receive an encrypted message and a device address, never health
  values in readable form, only if you turn notifications on.]

We do not sell your data, use it for advertising, or share it with anyone else unless required by law.

### Where it is stored

On [server location / country]. [State whether data leaves the EU/EEA and the safeguards used.]

### How long we keep it

Until you delete it or your account. Deleted data is removed from the live database and files immediately;
backups are overwritten within [N days].

### Your rights

You can, at any time:

- **Export** all your household's data (Settings → export) and take it elsewhere (data portability, Art. 20).
- **Correct** or delete individual records in the app.
- **Delete your account** (Settings). If you are the only owner of a household, this deletes the household and
  all its records and files.
- **Withdraw consent** by deleting your account; withdrawal does not affect processing before it.
- Ask us for access, rectification, erasure or restriction, or object to processing: [contact email].
- Complain to a supervisory authority, for example [your local data protection authority].

### Security

Sign-in uses one-time email links and passkeys; sessions are HTTP-only cookies over HTTPS. Data is kept in a
database with owner-only file permissions on [an encrypted disk]. [Describe backups and who has server access.]

### Changes

If this notice changes in a way that affects how health data is processed, the app asks you to accept the new
version before you continue.
