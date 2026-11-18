# T-509 scouting sets: real deliveries beyond security reviews

Desk research, 2026-11-18. Each entry starts from a public file or record. Labels: **[m]** measured (read on the page named), **[i]** inferred, **[g]** guessed. "Fits" means fits Crow's limits: one CSV or JSON file of at most 1 MiB, declarative checks only.

## 1. Robot training data

**1.1 LeRobot `pusht`**
- Address: https://huggingface.co/datasets/lerobot/pusht (`meta/info.json`). Licence: MIT [m].
- Delivery: LeRobot v3.0 layout [m]: `meta/info.json` plus Parquet frames at `data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet` [m]. 206 episodes, 25,650 frames at 10 fps, 7.69 MB in total [m]. Frame features: `observation.image` (video, 96×96×3), `observation.state` (float32 [2]), `action` (float32 [2]), `episode_index`, `frame_index`, `timestamp`, `next.reward`, `next.done`, `next.success`, `index`, `task_index` [m].
- Check could test: `info.json` against a JSON Schema (feature names, dtypes, shapes, `fps`, `total_episodes`) [i]. The frames are Parquet, so they are not a Crow delivery format as-is [i].
- Needs a model: whether the demonstrations are competent and diverse, and whether the video shows the task [i].

**1.2 LeRobot `aloha_sim_insertion_human`**
- Address: https://huggingface.co/datasets/lerobot/aloha_sim_insertion_human. Licence: not read [m: not checked].
- Delivery: same v3.0 layout [m]. `robot_type: aloha`, 50 episodes, 25,000 frames at 50 fps [m]. State and action are float32 [14] (two arms, 7 joints each) [m]. Video is under `videos/{video_key}/chunk-.../file-....mp4` [m].
- Check could test: a declared `robot_type`, the episode count, vector widths, and frames = episodes × length (here 500 frames per episode) [i].
- Needs a model: the quality of the human teleoperation [i].

**1.3 DROID**
- Address: https://droid-dataset.github.io/ and https://droid-dataset.github.io/droid/the-droid-dataset. Licence: not stated on the pages read [m].
- Delivery: RLDS through TensorFlow Datasets (`tfds.load("droid", data_dir="gs://gresearch/robotics")`) [m]. 76k trajectories, 350 h, 564 scenes, 86 tasks [m]. RLDS is 1.7 TB; raw stereo MP4 is 8.7 TB; a 100-episode debug subset is 2 GB [m]. Step fields: `is_first`, `is_last`, `is_terminal`, `language_instruction` (plus `_2`, `_3`), `observation`, `action_dict`, `action`, `discount`, `reward` [m]. Episode metadata: `recording_folderpath`, `file_path` [m].
- Check could test: a per-episode manifest (step count, first/last flags, instruction present) as CSV/JSON [i].
- Needs a model: whether the instruction matches what the video shows [i].

**1.4 Open X-Embodiment**
- Address: https://github.com/google-deepmind/open_x_embodiment. Licence: code Apache 2.0; other materials CC BY 4.0 [m].
- Delivery: 60 datasets from 34 labs, 1M+ trajectories, 22 embodiments [m]. Each dataset is "a sequence of episodes" in the RLDS episode format [m], hosted at `gs://gdm-robotics-open-x-embodiment/{dataset_name}` [m]. RT-1-X actions are 7 values (x, y, z, roll, pitch, yaw, gripper) [m].
- Check could test: conformance of a dataset's feature spec to RLDS (step keys, dtypes) [i].
- Needs a model: cross-dataset consistency of action semantics and units [i].

**1.5 BridgeData V2**
- Address: https://rail-berkeley.github.io/bridgedata/ (download: https://rail.eecs.berkeley.edu/datasets/bridge_release/data/). Licence: CC BY 4.0 [m].
- Delivery: 60,096 trajectories (50,365 teleoperated, 9,731 scripted) [m]; JPEG images at 640×480 from up to four cameras; a natural-language instruction per trajectory; teleoperated by VR controller at 5 Hz [m]. Zip files [m]. Action fields not described on the page [m].
- Check could test: counts per split, the instruction is non-empty, image dimensions declared [i].
- Needs a model: whether the instruction describes the trajectory [i].

**What the set says.** Robot data ships as a small JSON manifest plus large binary payloads (Parquet, MP4, TFRecord) of megabytes to terabytes [m]. A Crow delivery could carry the manifest (for example LeRobot's `meta/info.json`, which is JSON Schema-checkable) and a hash of the payload, not the payload [i]. Quality of the demonstrations needs a model or a human watching video [i].

## 2. Robot task execution

**2.1 LeRobot policy evaluation, `diffusion_pusht`**
- Address: https://huggingface.co/lerobot/diffusion_pusht/raw/main/eval_info.json. Licence: Apache-2.0 [m].
- Delivery: one JSON file, 75.8 kB [m]. Keys `per_episode` (500 entries of `episode_ix`, `sum_reward`, `max_reward`, `success`, `seed`), `aggregated` (`avg_sum_reward`, `avg_max_reward`, `pc_success` = 65.4 %, `eval_s`, `eval_ep_s`), `video_paths` (10 MP4 paths) [m].
- Check could test: schema; 500 entries; seeds 1000 to 1499 unique; `pc_success` equals the share of `success: true` [i]. Fits Crow as-is [i].
- Needs a model: nothing for the numbers; whether the run is genuine needs a re-run or a trusted evaluator [i].

**2.2 BEHAVIOR Challenge 2025 episode result**
- Address: https://behavior.stanford.edu/challenge/archive/2025/submission.html. Terms: submission rules on the page; no data licence stated [m].
- Delivery: per episode, one JSON of metrics plus one MP4 [m]. JSON keys: `agent_distance` and `normalized_agent_distance` (`base`, `left`, `right`), `q_score.final`, `time` (`simulator_steps`, `simulator_time`, `normalized_time`) [m]. 50 tasks × 10 instances = 500 JSON files; missing rollouts score zero; "not allowed to modify the output JSON files" [m].
- Check could test: schema, the 500-file count, `q_score` in range [i].
- Needs a model: none for the score; integrity rests on who ran the evaluator [i].

**2.3 RoboArena pairwise evaluations**
- Address: https://arxiv.org/html/2506.18123 (paper; CC BY 4.0 for the paper, data licence not stated) [m]. Third-party snapshots list MIT, not verified [m].
- Delivery: per evaluation, a language instruction, an A/B (or tie) preference, a 0 to 100 progress score per policy, a free-text explanation, and rollout recordings [m]. 600+ real-robot episodes over 7 policies on DROID hardware in the paper [m].
- Check could test: preference in {A, B, tie}, progress an integer 0 to 100, instruction present [i].
- Needs a model: whether the free-text explanation is consistent with the scores and video [i].

**2.4 SimplerEnv**
- Address: https://github.com/simpler-env/SimplerEnv. Licence: MIT [m].
- Delivery: real and simulated success rates per policy per task, as a Python dict (`REAL_PERF["google_robot_move_near"][p]`) in `simpler_env.utils.metrics`; videos on Hugging Face [m]. No CSV or column list stated [m].
- Check could test: once exported to CSV, task × policy rows with a rate in [0, 1] [i].
- Needs a model: little; the value is the sim-to-real correlation, a computed number [i].

**2.5 NIST ARIAC (industrial kitting and assembly)**
- Address: https://pages.nist.gov/ARIAC_docs/en/2024.1.0/evaluation/scoring.html. NIST works are not under US copyright [m].
- Delivery: a scoring formula, not a published file: trial score TS = CF × Σ(pm × EF × S) per order, with a priority multiplier of 3 [m]. Logs exist in a logs folder; no field list on the page [m].
- Check could test: recompute TS from per-order task scores and times [i].
- Needs a model: nothing; this is the most deterministic of the set [i]. Weakest source: no file read.

**What the set says.** Task-execution results are small JSON or CSV files (tens of kB) with booleans and scores, which fit Crow directly [m: 75.8 kB for 2.1]. Deterministic checks can verify internal consistency (counts, ranges, aggregates match rows), not that the robot did it; that rests on video, a re-run, or a trusted evaluator [i]. Human preference data (RoboArena) adds free text that needs a model [i].

## 3. Non-official legal review

**3.1 CUAD (Contract Understanding Atticus Dataset)**
- Address: https://huggingface.co/datasets/theatticusproject/cuad-qa. Licence: CC BY 4.0 [m].
- Delivery: 510 commercial contracts, 13,000+ "expert annotations" in 41 clause categories [m]. SQuAD-style records: `id`, `title`, `context`, `question`, `answers` (`text`, `answer_start`) [m]; 22,450 train and 4,182 test rows [m]. Annotators were expert-supervised; the pages read do not say law students or lawyers [m].
- Check could test: each `answer_start` offset lands on `text` inside `context`; category from the fixed list of 41 [i].
- Needs a model: whether the right clause was found, or a clause was missed [i].

**3.2 ContractNLI**
- Address: https://stanfordnlp.github.io/contract-nli/. Licence: CC BY 4.0 [m].
- Delivery: one JSON with `documents` and `labels` [m]. 607 NDAs × 17 fixed hypotheses; each annotation has `choice` (`Entailment`, `Contradiction`, `NotMentioned`) and `spans` (empty for `NotMentioned`) [m].
- Check could test: every document has all 17 hypotheses; `choice` in the enum; spans empty exactly when `NotMentioned`; span indexes valid [i]. Very close to Crow's `json_schema` check [i].
- Needs a model: whether the choice is correct [i].

**3.3 MAUD (merger agreements)**
- Address: https://www.atticusprojectai.org/maud. Licence: CC BY 4.0 [m].
- Delivery: 152 merger agreements, 47,000+ labels, 92 questions per agreement from the 2021 ABA deal points study, labelled "under the supervision of experienced lawyers" [m]. File format not described on the page [m].
- Check could test: 92 answers per agreement, answers from each question's option list [i].
- Needs a model: correctness of each deal-point answer [i].

**3.4 LegalBench**
- Address: https://huggingface.co/datasets/nguha/legalbench. Licence: CC BY 4.0 overall, per-task terms vary [m].
- Delivery: 162 tasks from 40 contributors, CSV with Parquet conversion; example rows `text`, `answer`, `index` [m] (e.g. `abercrombie`, 5 train and 95 test rows, 5 labels) [m].
- Check could test: answers from the task's label set; row count matches the task [i].
- Needs a model: the open-ended tasks (rule application, explanations) [i].

**3.5 ToS;DR (volunteer terms-of-service review)**
- Address: https://docs.tosdr.org/developer/tos-dr-developers/restful-api/service-api/get-service-v3. Licence: services and points data CC BY-SA 3.0, software AGPL-3.0 per the project's topics page (search result) [m: secondary].
- Delivery: one JSON per service: `id`, `name`, `rating`, `urls`, `documents`, `points[]` [m]. Each point: `title`, `source`, `status`, `analysis`, `case`, `document_id` [m]; each case: `weight`, `title`, `classification`, `topic_id` [m]. Reviewers are volunteers, not lawyers [i].
- Check could test: each point cites a `document_id` that exists; `case.classification` from a fixed set; `rating` consistent with weights [i].
- Needs a model: whether the `analysis` quote actually says what the case claims [i].

**What the set says.** Public legal review data is either span labels (CUAD, ContractNLI) or fixed questions with fixed answer sets (MAUD, LegalBench, ToS;DR cases) [m]. That form suits Crow well: structure, enums and span offsets are deterministic; the correctness of each answer needs a model or a reference file [i]. No public redline or issues list from a contract-review tool turned up [m].

## 4. Product review (tester's report with measured results)

**4.1 NHTSA NCAP 5-Star Safety Ratings**
- Address: https://api.nhtsa.gov/SafetyRatings/VehicleId/18954 (2023 Toyota Camry FWD). Terms: US government data [i].
- Delivery: JSON `{Count, Message, Results[]}` [m]. Fields include `OverallRating`, `FrontCrashDriversideRating`, `SideCrashDriversideRating`, `RolloverRating`, `RolloverPossibility` (0.099), `dynamicTipResult` ("No Tip"), test photo and video URLs, `ComplaintsCount`, `RecallsCount` [m].
- Check could test: ratings integers 1 to 5 or "Not Rated"; `RolloverPossibility` in [0, 1]; URLs resolve; compare against the API by hash [i].
- Needs a model: nothing for the ratings; the test video if it is in question [i].

**4.2 ENERGY STAR Certified Televisions**
- Address: https://data.energystar.gov/resource/pd96-rr3d.json (Socrata; CSV at `.../api/views/pd96-rr3d/rows.csv`). Publisher: US EPA [m].
- Delivery: one row per model [m]. Example: Insignia NS-32F202NA27, `power_consumption_in_on_mode_watts` 31.91 W, `maximum_on_mode_power_for_certification_watts` 37.9 W, `reported_annual_energy_consumption_kwh` 66.00 kWh, standby 0.18 W and 0.30 W, `date_qualified` 2026-04-27 [m]. Values carry units inside the string ("31.91 W") [m].
- Check could test: measured on-mode power ≤ the certification maximum; resolution and size fields in range [i]. Units in strings need a parse rule [i].
- Needs a model: nothing; this is the most check-friendly product report [i].

**4.3 Euro NCAP adult occupant protocol and datasheet**
- Address: https://www.euroncap.com/media/79871/euro-ncap-assessment-protocol-aop-v93.pdf; datasheet example via ADAC (search result) [m]. Licence: reproduction needs Euro NCAP's written permission [m].
- Delivery: PDF datasheets; the example shows adult occupant 30.7 points, 80 % [m, secondary]. Frontal impact is 40 points (20 offset, 20 compatibility) and side impact 35 points in the newer protocols [m, secondary].
- Check could test: subtotals sum to the total; points within each protocol's maximum [i].
- Needs a model: PDF only, so extraction first [i].

**4.4 Notebookcheck laptop review**
- Address: https://www.notebookcheck.net/Our-Test-Criteria.15394.0.html. Terms: copyrighted editorial content [i].
- Delivery: an HTML review with measured values, e.g. Wi-Fi v1.3 browsing runtime 22.6 h at 150 cd/m² for one ThinkPad P1 Gen 9 configuration [m, secondary]. Test conditions are named in the criteria page [m, secondary].
- Check could test: a result names its test version and brightness, and carries a unit [i].
- Needs a model: whether the prose verdict follows from the measurements [i].

**4.5 RTINGS test benches**
- Address: https://www.rtings.com/tv/tests/methodology. Terms: membership site; reuse terms not stated on that page [m].
- Delivery: results tied to a numbered test bench (1.0 to 2.4, latest 2.4 on 2026-11-10) with tests such as HDR Brightness, PQ EOTF and Color Volume [m]. Units and score scale not on the page read [m].
- Check could test: the report names its test-bench version; all required tests present [i].
- Needs a model: comparison across bench versions; prose [i].

**What the set says.** Government test data (NHTSA, ENERGY STAR) comes as JSON or CSV rows with measured values and certification limits, which deterministic checks can test directly [m]. Editorial labs publish HTML or PDF under copyright, tied to a named protocol version [m]. For Crow, the useful pattern is "report names a protocol version and carries each measured value with a unit," with the verdict prose left to a model [i].

## 5. One source per other kind

- **QA test run report.** Playwright reporters, https://playwright.dev/docs/test-reporters [m]. `--reporter=json` writes "an object with all information about the test run"; `--reporter=junit` writes JUnit XML with a `<testsuites>` root carrying `id` and `name` [m]. Check: test counts, no failures, required test names present (JSON fits Crow; XML does not) [i]. Model: whether the tests test the right thing [i].
- **AI code review output.** GitHub REST "Create a review for a pull request", https://docs.github.com/en/rest/pulls/reviews [m]. A review is `commit_id`, `body`, `event` (`APPROVE`, `REQUEST_CHANGES`, `COMMENT`), `comments[]` with `path`, `line`, `side`, `start_line`, `body` [m]. Check: `commit_id` matches the agreed commit; each `path` exists in the diff [i]. Model: whether comments are correct and useful [i].
- **Web scraping and extraction.** Web Data Commons, https://webdatacommons.org/structureddata/ [m]. schema.org JSON-LD, Microdata and RDFa extracted from Common Crawl as N-Quads whose fourth element is the source URL; October 2024: 1.4 TB compressed, 74 billion triples; "for research purposes only" [m]. Check: every record carries its source URL; required properties present [i]. Model: whether values match the live page [i].
- **Document parsing (PDF to structured).** Docling's DoclingDocument, https://docling-project.github.io/docling/concepts/docling_document/ [m]. JSON with `texts`, `tables`, `pictures`, `key_value_items`, `body`, `furniture`, `groups`, with provenance and bounding boxes when available [m]. Licence not on that page [m]. Check: schema; page references within the page count [i]. Model: fidelity to the PDF [i].
- **Business verification (KYB).** GLEIF LEI record, https://api.gleif.org/api/v1/lei-records/5493001KJTIIGC8Y1R12 [m]. Fields: `lei`, legal name, legal address, `jurisdiction` US-DE, entity `status` ACTIVE, registration `status` ISSUED, `initialRegistrationDate`, `nextRenewalDate` 2027-01-25, `corroborationLevel` FULLY_CORROBORATED [m]. Licence CC0 [g: not read]. Check: LEI format and checksum, renewal date in the future, match against the registry record by hash [i]. Model: little [i].
- **Financial statement extraction.** SEC EDGAR XBRL APIs, https://www.sec.gov/search-filings/edgar-application-programming-interfaces [m]. `companyconcept` returns `cik`, `tag`, `units`; each fact has `end`, `val`, `accn`, `fy`, `fp`, `form`, `filed`, sometimes `frame` [m]. No key needed [m]. Check: every extracted value matches the filed XBRL fact for the same `accn` and tag [i]. Model: for figures not tagged in XBRL [i].
- **Cited research report.** DeepResearch Bench, https://github.com/Ayanami0730/deep_research_bench [m]. JSONL lines of `id`, `prompt`, `article` (the report with citations); FACT scoring extracts statement-URL pairs and checks support with web fetches and a model [m]. Licence: Apache-2.0 in the sidebar, MIT in a badge [m]. Check: every citation is a well-formed URL, count of cited sources [i]. Model: whether each source supports its statement [i].
- **Human labelling or survey.** Label Studio export, https://labelstud.io/guide/export [m]. JSON tasks with `data`, `annotations[]` (`result[]` of `from_name`, `to_name`, `type`, `value`; `completed_by`; `lead_time` in seconds; `was_cancelled`); also `JSON_MIN`, CSV, TSV, COCO, YOLO [m]. Check: every task labelled, labels from the label set, `lead_time` above a floor, agreement with gold tasks [i]. Model: free-text answers [i].
- **Wet-lab protein assay.** ProteinGym, https://github.com/OATML-Markslab/ProteinGym. Licence MIT [m]. 217 substitution and 74 indel deep mutational scanning assays; per assay rows of `mutant` (e.g. "A1P:D2N"), `mutated_sequence`, `DMS_score`, `DMS_score_bin` (1 fit, 0 not) [m]. Check: `mutant` consistent with `mutated_sequence` against the reference; bin consistent with the cutoff; row count [i]. Model: whether the assay was done (needs lab records, not a model) [i].
- **Satellite imagery order.** STAC Item spec, https://github.com/radiantearth/stac-spec/blob/master/item-spec/item-spec.md [m]. GeoJSON `Feature` with `stac_version`, `id`, `geometry`, `bbox`, `properties.datetime`, `links`, `assets` (recommended roles `thumbnail` and `data`) [m]. Check: footprint intersects the ordered area; datetime in the ordered window; asset hashes [i]. Model: cloud or image quality if not in metadata [i].
- **Compute or simulation job.** Slurm `sacct`, https://slurm.schedmd.com/sacct.html [m]. `--json` or `--parsable2` output with `JobID`, `State`, `ExitCode`, `Elapsed`, `AllocTRES`, `MaxRSS`, `ConsumedEnergy`; states include `COMPLETED`, `FAILED`, `TIMEOUT`, `OUT_OF_MEMORY` [m]. Check: `State` is `COMPLETED`, `ExitCode` 0:0, elapsed and resources within the order [i]. Model: whether the output files are scientifically sound [i].

**What the set says.** Nine of the eleven kinds already have an open, documented JSON or CSV format with enums, counts and identifiers that a JSON Schema or row check can test [i]. The strongest deterministic check across kinds is a match against a public authority by hash or key (SEC `accn`, GLEIF LEI, NHTSA `VehicleId`, STAC asset checksums) [i]. A model is still needed wherever the claim is "this is correct or supported" rather than "this is well formed" [i].
