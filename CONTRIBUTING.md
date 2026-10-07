# Contributing to VAULT

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome.

## How changes get in

VAULT has one maintainer ([@adigasuhas](https://github.com/adigasuhas)). Nobody else can push to `main`. Every change, including the maintainer's own, goes through a pull request, and nothing is merged until the maintainer has reviewed it.

1. **Open an issue first** for anything bigger than a small fix, so we can agree on the approach before you spend time on it.
2. **Fork** the repository and create a branch from `main`.
3. **Make your change.** Keep it focused: one feature or fix per pull request.
4. **Check it locally:**
   ```bash
   npm run lint
   npm test
   ```
5. **Open a pull request** against `main`, describe what it changes and why, and tick the contributor agreement box in the template.

The maintainer may ask for changes, merge it, or close it. A closed pull request isn't a judgement of your work. It may just not fit where the project is going.

## Guidelines

- Match the style of the code around you.
- Money is handled through the append-only ledger. Never update or delete ledger entries directly. Post a reversal instead.
- Add or update tests for behaviour you change.
- Don't commit secrets, `.env` files or real financial data.

## License and contributor agreement

VAULT is **source-available** under the [PolyForm Noncommercial License 1.0.0](LICENSE). Anyone may use, modify and share it for noncommercial purposes. Nobody may use it commercially.

By submitting a pull request, you agree to the following:

1. **It's yours to give.** You wrote the contribution yourself, or you have the right to submit it, and it doesn't include code you aren't allowed to share.
2. **You keep your copyright.** You remain the owner of your contribution.
3. **You grant the maintainer a broad license.** You give Suhas Adiga a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, copy, modify, distribute, sublicense and relicense your contribution, for any purpose, **including commercial purposes**, and under any license terms, along with any patent rights you hold that the contribution would necessarily infringe.
4. **Everyone else gets it under the project license.** Your contribution is published to the public under the PolyForm Noncommercial License 1.0.0, like the rest of VAULT.
5. **No warranty.** You provide the contribution "as is", and you're not expected to support it.

Point 3 exists so the project can keep evolving, for example changing its license or offering a hosted version, without having to track down every past contributor. If you're not comfortable with that, please open an issue to discuss it instead of sending a pull request.

## Reporting security issues

Please don't open a public issue for security problems. Contact the maintainer privately through GitHub instead.
