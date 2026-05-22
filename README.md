# Tian Xiwei Vote Assist

Manual-in-the-loop assistant for the Bugs signup flow and Bugs favorite vote.

The script automates navigation, normal form filling, and the final favorite vote popup. It pauses for the human steps:

- captcha entry and Sign Up retry

## Setup

```bash
npm install
```

If your Cloakbrowser install needs a fixed browser binary path, copy the example config:

```bash
cp vote-assist.config.example.json vote-assist.config.json
```

Then set `executablePath` in `vote-assist.config.json`.

## Run

Create a new Bugs account, verify email, vote once, and save the account:

```bash
npm run vote-assist:signup
```

Run signup-vote multiple times:

```bash
npm run vote-assist:signup -- 100
```

Login saved accounts that have not voted today, then vote:

```bash
npm run vote-assist:login
```

Limit the login command to the first N eligible accounts:

```bash
npm run vote-assist:login -- 3
```

The signup command will:

1. Open temp-mail and read the generated email.
2. Open Bugs signup and fill the registration form.
3. Pause while you enter captcha and submit until Bugs accepts it.
4. Watch for registration success.
5. Return to temp-mail, refresh, open the Bugs email, and click Email Authentication when visible.
6. Open the Bugs favorite page, record the current vote scores to `data/vote-score-history.csv`, find TIAN Xiwei, and vote.
7. Save the account to `data/accounts.json`.

The login command will:

1. Read `data/accounts.json`.
2. Skip accounts that already voted today.
3. Open the Bugs login form, then fill it at `https://music.bugs.co.kr/member/loginview`.
4. If Cloudflare appears, the script keeps watching for the verification to complete and auto-clicks Log in as soon as the button becomes enabled.
5. Record the current vote scores to `data/vote-score-history.csv`, vote TIAN Xiwei, and update `lastVotedAt`.
6. Delete the fresh browser profile before moving to the next account.

The vote score CSV is newest-first and has these columns:

```csv
checked_at,tian_xiwei_votes,top1_votes
```
