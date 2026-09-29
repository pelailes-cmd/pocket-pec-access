# Pocket PEC access codes

Sell Pocket PEC with one-time access codes:

* **Seller page** (`site/`, hosted free on GitHub Pages): sign in, generate a
  code for each buyer, copy a ready-made message, see which codes are used,
  revoke a code, or free it when a buyer changes phones.
* **Supabase** (`supabase/`): stores the codes (Row Level Security, admins
  only) and runs the `redeem` function that activates the app.
* **The app** asks for a code on first launch, sends it once over the
  internet, and gets a license signed with your private key. The app checks
  that signature offline on every launch, so it never needs the internet again.

A code binds to the first phone that uses it. The same phone can reinstall
and activate again without your help. Any other phone is refused until you
press **Free for new phone**.

## One-time setup

Steps 1 and 2 happen entirely in the Supabase website. **Nothing needs to be
installed**, including the Supabase CLI. Only step 3 uses a command window.

### 1. Create the Supabase project and database
1. Create a project at supabase.com (choose a region near your buyers, e.g. Singapore).
2. Open **SQL Editor** (left menu), paste everything from
   `supabase/migrations/20260929000000_access_codes.sql`, and click **Run**.
3. **Authentication → Users → Add user**: your email and a strong password
   (tick *Auto Confirm User*). This is your seller login.
4. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up".
5. **SQL Editor** again, with your own email, then **Run**:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
   ```

### 2. Add the activation function
The app talks to a small program that runs on Supabase, called an *Edge
Function*. You create it by copy and paste.

**2a. Create the function**
1. On this PC, open the folder
   `C:\Users\Mary Grace P. Beato\pocket-pec-access\supabase\functions\redeem`.
2. Right-click `index.ts` → **Open with** → **Notepad**. Press **Ctrl+A**, then **Ctrl+C**.
3. In Supabase, click **Edge Functions** in the left menu, then
   **Deploy a new function** → **Via Editor**.
4. Click inside the code editor, press **Ctrl+A**, then **Ctrl+V**. Your code
   replaces the example code.
5. Set the function name (below the editor) to exactly **`redeem`**.
6. Click **Deploy function** and wait until it has deployed. You land on
   the function's page.

**2b. Let buyers' phones reach it**
1. On the `redeem` function's page, open the **Details** tab.
2. Switch **off** *Enforce JWT Verification* (some screens call it *Verify JWT*).
3. Click **Save changes**.

Buyers have no Supabase account, so the function checks every request itself.

**2c. Add your private key as a secret**
1. On this PC, open `C:\Users\Mary Grace P. Beato\pocket-pec-secrets`.
2. Right-click `LICENSE_SIGNING_KEY.txt` → **Open with** → **Notepad**. It is a
   single line of 44 characters ending in `=`. Press **Ctrl+A**, then **Ctrl+C**.
3. In Supabase, open **Edge Functions → Secrets**.
4. Name: **`LICENSE_SIGNING_KEY`**. Value: paste (**Ctrl+V**). Click **Save**.
   You do not need to deploy again.

This key is what makes licenses genuine. Never send it to anyone or put it on
GitHub, and keep a private backup of the `pocket-pec-secrets` folder (e.g.
in a password manager or on a USB drive you keep safe).

**2d. Check that it works**

Open this address in your browser, with your project's ID in place of
`YOUR-PROJECT-REF`:

`https://YOUR-PROJECT-REF.supabase.co/functions/v1/redeem`

(The project ID is the random-looking part of your Project URL. The
function's page also shows the full address to copy.)

You should see:

```
{"ok":true,"service":"pocket-pec-redeem","signingKey":"ok","database":true}
```

| If you see | Do this |
|---|---|
| `"signingKey":"missing"` | Redo 2c. The name must be exactly `LICENSE_SIGNING_KEY` |
| `"signingKey":"wrong"` | The value is from another file or incomplete; copy `LICENSE_SIGNING_KEY.txt` again (2c) |
| `"database":false` | Run the SQL from step 1.2 again |
| A message about *authorization*, *JWT* or *header* | Redo 2b |
| *Function not found* | The name is not `redeem`; redo 2a |

The function never issues a license while the check shows a problem, so a
setup mistake cannot use up a buyer's code.

<details>
<summary>Command-line alternative (optional, same result)</summary>

Node.js is enough, since `npx` runs the Supabase CLI without installing it.
In a command window inside this folder:

```sh
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase secrets set LICENSE_SIGNING_KEY=THE-LINE-FROM-LICENSE_SIGNING_KEY.txt
npx supabase functions deploy redeem --no-verify-jwt --use-api
```

If `link` asks for the database password you can press Enter to skip it.
Then do the check in 2d.
</details>

### 3. The seller page on GitHub
1. Edit `site/config.js` with Notepad: put in your **Project URL** and your
   **anon public key** (Supabase → **Project Settings → API Keys**; newer
   screens may call it the *Publishable key*). Optionally set `appDownloadUrl`.
2. Create a GitHub repository (e.g. `pocket-pec-access`) and push this folder
   from a command window opened in this folder:
   ```sh
   git add . && git commit -m "Access portal"
   git branch -M main
   git remote add origin https://github.com/YOUR-USER/pocket-pec-access.git
   git push -u origin main
   ```
3. GitHub → the repository → **Settings → Pages → Source: GitHub Actions**. The
   page is published at `https://YOUR-USER.github.io/pocket-pec-access/`.

The repository contains no secrets: the anon key is public by design, and
the codes are only readable after you sign in as an admin. A free GitHub
account needs a public repository for Pages; that is safe here.

### 4. Build the app for your project
From the app folder (`C:\src\pocket-pec`):
```sh
flutter build apk --release \
  --dart-define=PEC_REDEEM_URL=https://YOUR-PROJECT-REF.supabase.co/functions/v1/redeem \
  --dart-define=PEC_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY \
  --dart-define=PEC_SELLER_CONTACT="your Facebook page or number"
```
Sign every release with the same release key (see the app's README,
*Release signing*). On Android the device binding depends on it.

## Selling
1. Open the seller page, sign in, enter the buyer's name and payment
   reference, press **Generate**.
2. Press **Copy message for buyer** and send it with the APK.
3. The buyer opens the app once with internet and enters the code. The row
   turns **Activated** with the phone model.

| Situation | What to do |
|---|---|
| Buyer reinstalled the app on the same phone | Nothing, the code works again on that phone |
| Buyer got a new phone or factory-reset | **Free for new phone**, then they enter the same code |
| Refund, or a code was leaked before use | **Revoke** (a phone that already activated keeps working, because it is offline) |
| Typo when generating | **Delete** (only unused codes) |

## Limits to know
* Activation needs Supabase to be up. **Free Supabase projects pause after
  about a week without activity.** Open the seller page regularly, or use a
  paid plan, so buyers can always activate.
* This stops casual sharing: a code works on one phone, and the app will not
  open without one. It cannot stop a determined person who modifies the APK,
  or who extracts the PDF bundled inside it. No offline app can.
* Revoking cannot switch off a phone that is already activated. That is the
  price of working fully offline.
* If the signing key ever leaks, make a new key pair
  (`openssl genpkey -algorithm ed25519`). Put the new public key in the app
  (`lib/licensing/license.dart`) and in the function (`PUBLIC_KEY` in
  `supabase/functions/redeem/index.ts`), redeploy the function, set the new
  secret, and release an app update. Everyone re-activates once.
