# Corrected identity-comparison live validation

The user said “Please proceed” after the v1 failure and simplified schema were
explained, and after the proposed check explicitly covered request acceptance,
the rejected likeness and the confirmed portrait match. This authorizes this
new Preview-only pair. Prior v1 controls remain closed, with records296/297 intact.

Reviewer is fixed to `reference-feature-comparison-v2` in the shared runVisionGate.
No scoring, prompt, source, reference, token cap or acceptance threshold changes
are part of this registration. Both requests retain the complete original host
brief and differ only in candidate bytes. Expected answers and user feedback are
server evaluation data only and never enter provider requests.

Event61, confirmed reference289 SHA
`347745ce1d75a4e5e8e7cacf20ca7fa693d4cb66c17d99f010e7c010113994b8`.
Host brief SHA`e4634856bdea506e3b711bef789c1c94b5f6ee578725b407753fe61959da19ad`.

| Case | Dataset | Candidate and expected identity result |
| --- | --- | --- |
| mismatched | meekah-feature-comparison-20260912-v2-mismatched | Saved human-rejected scene293; supported feature mismatch and consistent negative Meekah verdict. |
| matched | meekah-feature-comparison-20260912-v2-matched | Confirmed portrait289; positive Meekah feature match. Not an approved gouache invitation; missing other subjects/scene/medium still fail. |

Exact input hashes and dimensions remain those in IDENTITY_FEATURE_COMPARISON.md.
Strict owner route`/api/events/owner/:ownerToken/prepayment-preview/feature-comparison-v2/:caseId`
accepts only confirmOneVisionCalltrue and exact expectedAssetHash/expectedIdentityHash.
No arbitrary source, expected answer, prompt, registration or model is accepted.

Maximum two Anthropic calls, one per case, no generation/classification/repair/
SDK retry.45-second critic limit. Durable global claim and readback before each
dispatch. Run mismatched then matched on the same verified deployment. The server
requires an accounted completed first result before allowing the matching case;
a semantic miss may proceed, while provider/timeout/accounting/retention failure
or unknown outcome stops the pair. Claims cannot be reset or reused.

All records remain rejected/private, previewIdnull, customerActivationdisabled,
event unchanged. No merge or Production release. Save full returned evidence,
the actual observations and contradictions, timing/usage without double counting,
and exact current deployment/CI. Two correct results demonstrate only narrow
calibration; broad image quality, medium/craft reliability and launch gates remain.

## Actual result: stopped at the critic deadline

Executed mismatched once on5ed75477388aa7ca6e94280ba1a5fa38bc263c99,
Verify Posy CI437 success, Preview posy-709ecigyr-poseplans.vercel.app.
Event61 claim298/result299. The local45-second critic deadline aborted the
request: critic45002ms, stage45006ms, HTTP52325ms, Express route47290ms.
No visual response, feature observation, usage report or provider request ID
returned. Token zeros are fallback values, billing unknown. This does not
establish whether grammar compilation completed or where provider time was spent.

The matching case was not dispatched and is blocked by the server prerequisite.
Both v2 controls are closed under the registered stop rule. The first claim is
consumed; no retries, new images, classifiers, or replacement registration.
The event is unchanged, and both retained rows are rejected/private.

Read-only investigation found host requirement strings and reference keys in
dynamic schema enums. Anthropic documents additional latency for a new schema
and reuse of compiled grammars. This is an avoidable cache-variation risk,
not a proven explanation for the timeout. The corrective shared reviewer uses
one stable schema per mode/reference-presence combination: exact requirements
and reference keys remain in the unchanged task message, and server validation
still enforces complete, unique, in-scope responses. Unknown answers to a concrete
checklist fail explicitly; briefs without a concrete checklist retain their
existing holistic review behavior. Each dispatched verdict retains the schema
version and SHA.

No live call of this subsequent correction is authorized by the closed v2
registration or was made. Provider acceptance, latency, semantic calibration
and all original artwork/Plus/launch gates remain unproven.

Source: [Anthropic grammar compilation and caching](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#grammar-compilation-and-caching).
