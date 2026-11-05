# TUJP tree register

Web pages behind the NFC tags on TUJP trees. Tapping a tag opens `https://trees.theurbanjungleproject.com/tree/00018`.

- **Public visitors** see a short TUJP text, a few public fields and a "Report a problem" form.
- **TUJP staff** sign in with their TUJP Google account. They can register a new tree, edit its details and add visits with three photos and notes.
- **Blank tags** are programmed from the home page: it reserves the next free ID and writes the link onto the tag (Android), or gives the link to write with NFC Tools (iPhone).
- **Data** lives in the Google Sheet `Tree_Database_TUJP`, and photos in the Drive folder `Visits_Images`. AppSheet keeps working on the same data.

## How it fits together

```
NFC tag (link) ──> Netlify site (this repo, folder site/)
                       │  fetch, with Google sign-in token
                       v
                   Apps Script web app (this repo, folder apps-script/)
                       │
                       v
                   Google Sheet (Trees, Visits, Lists, Reports) + Drive (Visits_Images)
```

| Folder or file | What it is |
| --- | --- |
| `site/` | The pages Netlify publishes: `index.html` (home and tag programming), `tree.html` (one tree), `config.js` (settings), `assets/` |
| `apps-script/` | Backend code that runs inside the Google Sheet |
| `netlify.toml` | Netlify settings: publish `site/`, and send `/tree/*` to `tree.html` |
| `tests/` | Automated tests for the backend and the pages |

---

# Set-up, step by step

Order matters: Google first (you need its IDs), then GitHub and Netlify, then the domain.

## 1. Prepare the sheet (5 min)

1. Open the Google Sheet `Tree_Database_TUJP`.
2. On the **Lists** tab, add `Reserved` under `status` (below Replaced). The tag programming uses it to hold an ID while a tag is written.
3. Share the `Visits_Images` folder with `theurbanjungleproject.com` as Viewer, so colleagues see photo thumbnails.

## 2. Backend in Apps Script (15 min)

1. In the sheet: Extensions, then Apps Script.
2. Click Project settings (gear):
   - tick "Show appsscript.json manifest file in editor";
   - copy the **Script ID** (you need it in step 7).
3. Replace `Code.gs` with `apps-script/Code.gs` from this repo, and `appsscript.json` with `apps-script/appsscript.json`. Save.
4. Choose `testSetup` in the function dropdown and click Run. Allow the permissions with your TUJP account. If Google warns the app isn't verified: Advanced, then Go to (project).
5. Check the log: the Trees column names, `Photo folder: Visits_Images`, and a line with `"ok":true`.

## 3. Google sign-in client (15 min)

1. Go to https://console.cloud.google.com with your TUJP account and create a project `TUJP Tree Register`.
2. Open Google Auth Platform (or APIs & Services, then OAuth consent screen).
   - Audience / user type: **Internal** (only TUJP accounts can sign in).
   - App name `TUJP Tree Register`, support email yours.
3. Clients (or Credentials), then Create client: **Web application**.
   - Authorised JavaScript origins: `https://trees.theurbanjungleproject.com`.
   - Add the Netlify address too once you have it (step 6), eg. `https://tujp-trees.netlify.app`.
4. Copy the client ID (ends in `.apps.googleusercontent.com`) and paste it:
   - in `apps-script/Code.gs` at `CLIENT_ID` (also in the Apps Script editor, and save);
   - in `site/config.js` at `CLIENT_ID`.

If you can't choose Internal or create a project, your Workspace admin has restricted it and needs to do this step.

## 4. Publish the backend (5 min)

1. In Apps Script: Deploy, then New deployment, type **Web app**.
2. Execute as **Me**, Who has access **Anyone**. Deploy.
3. Copy the Web app URL (ends in `/exec`) into `site/config.js` at `API_URL`.

"Anyone" lets the public page read the public fields. Every change still requires a valid TUJP sign-in, checked on the server.

**Updating the backend later:** Deploy, then Manage deployments, the pencil, Version: New version, Deploy. This keeps the same URL. A new deployment would get a new URL and break the site.

## 5. GitHub repository (10 min)

1. On GitHub, create a new **private** repository, eg. `tree-register`, in the TUJP organisation if there is one. Don't add a README (this repo has one).
2. Upload the contents of this folder. Either:
   - on the empty repo page, click "uploading an existing file" and drag in everything; or
   - with git on your computer:

```
cd tree-register
git remote add origin https://github.com/YOUR-ORG/tree-register.git
git push -u origin main
```

Do not commit `.clasp.json` or any password. `config.js` only holds public IDs, so it's fine to commit.

## 6. New Netlify site (10 min)

1. In Netlify: Add new project (or Add new site), then Import an existing project, then GitHub. Allow Netlify to see the `tree-register` repo.
2. Build settings: leave the build command empty, publish directory `site`. `netlify.toml` already sets this.
3. Deploy. You get an address like `https://random-name.netlify.app`. Rename it under Site configuration, eg. `tujp-trees`.
4. Add that address as an authorised JavaScript origin in Google Cloud (step 3.3).
5. From now on every push to `main` on GitHub publishes automatically.

## 7. Domain `trees.theurbanjungleproject.com` (10 min, plus waiting for DNS)

1. In Netlify: Domain management, Add a domain, enter `trees.theurbanjungleproject.com`.
2. Netlify shows a DNS record. Ask whoever manages the TUJP domain to add:

```
Type: CNAME   Name: trees   Value: tujp-trees.netlify.app
```

3. Wait until Netlify shows the domain as verified (minutes to a few hours). Netlify then sets up HTTPS by itself.

## 8. Test before writing real tags (15 min)

1. Open `https://trees.theurbanjungleproject.com/tree/00042` on your phone. You should see "Not linked yet".
2. Sign in with your TUJP account. The register form appears. Register a test tree and add a visit with three photos.
3. Check the sheet: the Trees row, a new Visits row, and three photos in `Visits_Images` named after the tree.
4. Sign out. You should see only the public fields. Send a test report: it appears in a new Reports tab and you get an email.
5. Sign in with a private Gmail account: the page should stay public only.
6. Program a test tag from the home page (step 9) and tap it with an iPhone and an Android phone.

## 9. Programming blank tags

Open `https://trees.theurbanjungleproject.com`, sign in, and tap **Get next free ID**. The ID is reserved for you in the sheet.

- **Android (Chrome):** hold a blank tag to the back of the phone and tap **Write tag**. The page refuses tags that already belong to another tree. Leave "Lock permanently" off unless you're sure: a locked tag can never be changed.
- **iPhone:** browsers on iPhone can't write tags. Tap **Copy link**, then in NFC Tools: Write, Add a record, URL, paste, Write. Then set the TUJP tag password (Other, Set password).

Then write the ID on the tag with a paint marker, fix it to the tree, and tap **Register this tree**.

Use NTAG213 tags (not MIFARE Classic, 1K or S50), waterproof, with a hole. Use the on-metal version for metal pots.

---

# Working on the code

## Settings

`site/config.js`: `API_URL`, `CLIENT_ID`, `BASE_URL` (the address on the tags, never change it once tags are out), photo size, public text and labels.

`apps-script/Code.gs`, top of the file:

- `CLIENT_ID` and `ALLOWED_DOMAIN`.
- `PUBLIC_FIELDS`: the columns the public sees.
- `REPORT_EMAIL`: empty means the script owner gets report emails, `'none'` switches emails off.

## Changing the sheet

The pages read the column headers, so you can add, rename or remove columns on the Trees tab without code changes, as long as you follow these rules:

- Keep `tree_id`, `tag_label` and `status`, and the Visits headers.
- A header containing "date" gets a date picker. `latitude` and `longitude` get a number field and the Use my location button.
- A column on the Lists tab with the same name (spaces count as underscores) turns the field into a dropdown.

## Pushing backend changes from the repo (optional, with clasp)

Instead of copy-pasting into the Apps Script editor:

1. Enable the Apps Script API at https://script.google.com/home/usersettings.
2. Install clasp and log in:

```
npm install -g @google/clasp
clasp login
```

3. Copy `.clasp.json.example` to `.clasp.json` and fill in the Script ID from step 2.2.
4. Push and redeploy the existing deployment (same URL):

```
clasp push
clasp deployments
clasp deploy -i THE-DEPLOYMENT-ID -d "describe the change"
```

## Tests

```
node tests/backend.test.js apps-script/Code.gs
python3 tests/pages.test.py site tests/shots
```

The backend test runs `Code.gs` against simulated Google services. The page test needs Python with Playwright and runs the site in a headless browser against a fake backend, including a simulated NFC tag.

## Known limits

- **No offline mode.** Registering and uploading need mobile signal. Use the AppSheet app where there is none.
- **Sign-in lasts about an hour.**
- **Web NFC is Android Chrome only.** On iPhone, tags are written with NFC Tools; reading works on both.
- **Reserved IDs** that were never written stay Reserved. Set them back to Unassigned in the sheet if needed.
