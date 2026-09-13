# Deploying the prototype

Two things to do before the proposal is sent: put the repository on GitHub as a public repository, and deploy it to a free instance in an EU region. Both are described step by step. Nothing here needs a paid account.

The demo holds no personal data and uses fictional parties, so a free tier is appropriate. It is still deployed in the EU on purpose: the platform will hold personal data of EU users in production, and the proposal says EU-resident hosting from day one. The demo should not contradict that.

## Part A. Push the repository to GitHub (public)

1. Sign in to GitHub. Create a new repository named `genelink-prototype`. Set it to **Public**. Do not initialise it with a README, licence or `.gitignore` (the project already has them).
2. In a terminal, from the `genelink-prototype` directory:

   ```bash
   git status                          # the repository was initialised by create-next-app
   git add -A
   git commit -m "GENE-LINK MVP prototype: configuration-driven ABS pathways for Colombia, Kenya and the Brazil dry run"
   git branch -M main
   git remote add origin https://github.com/<your-github-username>/genelink-prototype.git
   git push -u origin main
   ```

3. Confirm the repository is public by opening it in a private browser window. The README should render with the table of what the prototype proves.
4. Copy the URL. It replaces `[REPO_URL]` in every submission document and in the README itself.

Optional but recommended: enable GitHub Actions so evaluators see a green check. Create `.github/workflows/ci.yml` with:

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint:config
      - run: npm run typecheck
      - run: npm run test:ci
      - run: npm run build
```

Commit and push it. The workflow runs the configuration linter, the type check, the 52 tests and the production build on every push.

## Part B. Deploy to Render, Frankfurt, free tier

Render offers free web services with a Docker runtime and a Frankfurt region. A free instance sleeps after 15 minutes without traffic and takes about a minute to wake, which is acceptable for a demo and is stated in the interface banner.

1. Sign up at render.com with your GitHub account.
2. In the Render dashboard choose **New** then **Blueprint**. Connect the `genelink-prototype` repository. Render reads `render.yaml` at the repository root, which declares a free Docker web service in the Frankfurt region.
3. Click **Apply**. Render builds the Docker image. The Dockerfile runs the tests before the build, so a failing test fails the deploy. The first build takes several minutes.
4. When the service shows **Live**, open the URL Render assigns (it looks like `https://genelink-prototype.onrender.com`). Check:
   - The home page loads and the banner reads "Prototype with fictional parties".
   - `/persona` lists the seats. Act as Dr Ines Halvorsen. `/cases` shows three cases.
   - `/cases/case_1_ke` shows two halted stages.
   - `/verify` reports the audit chain verified.
5. Copy the URL. It replaces `[PROTOTYPE_URL]` in every submission document.

If the Blueprint option is unavailable, create the service by hand: **New**, **Web Service**, connect the repository, set Region to **Frankfurt (EU Central)**, Runtime to **Docker**, Instance Type to **Free**, leave the Dockerfile path as `./Dockerfile`, and create. Render detects the exposed port from the image.

### Keeping it awake during the evaluation window

A free instance that is asleep takes about a minute to respond to the first request. Two options:

- Accept it. The banner explains it.
- Before the presentations on 7 October, open the URL yourself a few minutes ahead so the instance is warm.

Do not add a third-party pinging service. It is unnecessary and looks like a workaround.

### Redeploying after a change

Push to `main`. Render rebuilds and redeploys automatically. Because the Dockerfile runs `npm run test:ci`, a change that breaks an invariant (for example a clock whose lapse target is a granted state) fails the build and the previous version stays live.

## Part C. Alternative EU hosts, no code change

The Dockerfile is the deployment. Any of these work with the same image:

- **Fly.io**, region `ams` (Amsterdam) or `fra` (Frankfurt): `fly launch --region fra`, then `fly deploy`. Fly's free allowance changes over time, check the current terms.
- **Scaleway Serverless Containers**, Paris or Amsterdam: push the image to Scaleway's registry and create a container from it.
- **Hetzner Cloud**, Falkenstein or Nuremberg: a CX23 instance (a few euros a month) running `docker run -d -p 80:3000 --restart unless-stopped genelink-prototype`. This is also the shape of the production recommendation in the proposal, with PostgreSQL added.

## Part D. After deploying

1. Replace `[PROTOTYPE_URL]` and `[REPO_URL]` in every file in `submission-genelink/` and in this repository's README.
2. Open the live URL in a private window and click every screen in the guided tour on the home page.
3. Re-export the submission PDFs.
