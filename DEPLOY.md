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

The repository already includes `.github/workflows/ci.yml`, so GitHub Actions runs the configuration linter, the type check, the 52 tests and the production build on every push. Evaluators will see the green check.

## Part B. Deploy to Northflank, Frankfurt, free tier

Northflank's free sandbox gives you an always-on service in an EU region (Frankfurt or Amsterdam), no credit card required, and it builds straight from the Dockerfile in the repository. Unlike Render's free tier it does not sleep, which is why this is the recommended host.

1. Sign up at northflank.com with your GitHub account. Stay on the free Sandbox plan (it includes two always-on services; you only need one).
2. Create a **Project**. When asked for a region, choose **Europe - West - Frankfurt** (`europe-west-frankfurt`). Amsterdam (`europe-west-netherlands`) is an equally good alternative.
3. In the project, create a new **Service** of type **Deployment**.
4. Under source, connect your GitHub account if prompted and select the `genelink-prototype` repository.
5. For build type choose **Dockerfile** (it is at the repository root). Northflank builds the image and deploys the container. The Dockerfile runs the test suite inside the build, so a failing test fails the deploy.
6. In the service's port settings, expose port **3000** as HTTP and public. The container listens on 3000 by default (`PORT` env var is respected if you prefer another).
7. Set environment variables `NODE_ENV=production` and `NEXT_TELEMETRY_DISABLED=1` if you want to be explicit; the image works without them.
8. Choose the smallest compute plan the sandbox offers (the app needs well under 512 MB). Deploy.
9. When the service shows running, open the URL Northflank assigns (a `code.run` address). Check:
   - The home page loads and the banner reads "Prototype with fictional parties".
   - `/persona` lists the seats. Act as Dr Ines Halvorsen. `/cases` shows three cases.
   - `/cases/case_1_ke` shows two halted stages.
   - `/verify` reports the audit chain verified.
10. Copy the URL. It replaces `[PROTOTYPE_URL]` in every submission document.

### Redeploying after a change

Push to `main`. Northflank rebuilds and redeploys the service automatically when connected to Git. The previous version stays live if the build fails, because the tests run inside the Docker build.

### If Northflank gives trouble

Two free alternatives, in order of preference:

- **Oracle Cloud Always Free.** A small VM (AMD `VM.Standard.E2.1.Micro`, or Ampere ARM where capacity allows) in Frankfurt or Amsterdam that is free forever and never sleeps. Sign-up asks for a card for identity verification but does not charge. Setup: create the VM with Ubuntu 24.04, open ports 80 and 443 in the security list, install Docker (`curl -fsSL https://get.docker.com | sh`), clone the repo, `docker build -t genelink-prototype .`, then `docker run -d -p 80:3000 --restart unless-stopped genelink-prototype`. More steps than Northflank, but the most robust free option and it will keep running long after the evaluation. If Ampere shows "out of host capacity", use the AMD micro shape or another availability domain.
- **Render.** Free web service in Frankfurt, no card, deploys from the same Dockerfile. Its free instances sleep after 15 minutes without traffic and take up to a minute to wake, which is the main reason it is not the first choice. If you use it, a free UptimeRobot monitor pinging the URL every five minutes keeps it awake within the 750 free instance hours per month.

A paid fallback that always works: a Hetzner CX22 in Falkenstein or Nuremberg is a few euros a month and runs the same `docker run` command as the Oracle option.

## Part C. After deploying

1. Replace `[PROTOTYPE_URL]` and `[REPO_URL]` in every file in `submission-genelink/` and in this repository's README.
2. Open the live URL in a private window and click every screen in the guided tour on the home page.
3. Re-export the submission PDFs.
