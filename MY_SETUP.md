# Deploy your private coding agent

This workspace copy is based on [Vercel's open-source coding-agent-template](https://github.com/vercel-labs/coding-agent-template) (MIT license). It runs coding agents in Vercel Sandboxes and supports Claude Code, with Anthropic credentials supplied by the server.

## Put the project in your GitHub account

The private repository [`wsetgg/ai-agent`](https://github.com/wsetgg/ai-agent) is ready for this project. Keep it private so your source stays under your account.

## Deploy it with Vercel

In Vercel, choose **Add New → Project**, import your private `wsetgg/ai-agent` repository, and deploy it. Add the required project settings from the template's [deployment guide](https://github.com/vercel-labs/coding-agent-template#deploy-your-own). The app needs a Postgres database, Vercel Sandbox credentials, encryption secrets, and one sign-in provider (GitHub or Vercel OAuth).

## Add your Anthropic key

In the Vercel project, open **Settings → Environment Variables** and add:

- **Name:** `ANTHROPIC_API_KEY`
- **Value:** your Anthropic API key
- **Type:** Secret
- **Environment:** Production (and Preview/Development only if you want to use those deployments)

Save it and redeploy. Don't put the key in source files, a `NEXT_PUBLIC_` variable, GitHub, or this chat. The app uses the server-side value as a fallback for Claude tasks; you can also add a per-user key in the app profile.

Only people with access to the Vercel project can manage its environment variables. Vercel supplies the key to the agent running in its Sandbox, which then uses it to call Anthropic.
