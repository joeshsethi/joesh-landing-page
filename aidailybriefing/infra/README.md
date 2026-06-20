# AWS backend setup

This provisions the DynamoDB table (feedback) and S3 bucket (archives) the service
uses when `AIDB_STORE=aws`. Everything runs locally without this — AWS is the
deploy target. Do this step deliberately when you're ready to go live with feedback.

## Prerequisites
- An AWS account and the AWS CLI installed (`aws --version`).
- `aws configure` done with an admin-ish profile (just for the one-time deploy).

## 1. Create the stack

```bash
aws cloudformation deploy \
  --stack-name aidb-backend \
  --template-file infra/cloudformation.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ArchiveBucketName=aidb-archives-joeshsethi
```

(Bucket names are globally unique — change the suffix if it's taken.)

## 2. Read the outputs

```bash
aws cloudformation describe-stacks --stack-name aidb-backend \
  --query "Stacks[0].Outputs" --output table
```

Note the `TableName`, `BucketName`, and the two policy ARNs.

## 3. Create two IAM users (least privilege)

The template creates *policies*, not users/keys (keys are secrets — better minted by
you). Create one user per consumer and attach the matching policy:

- **`aidb-vercel`** → attach `aidb-feedback-write`. This user's keys go in **Vercel**
  (feedback function, write-only).
- **`aidb-agent`** → attach `aidb-agent-readwrite`. This user's keys go in **GitHub
  Actions** (the agent: read feedback for reviews, write archives).

```bash
aws iam create-user --user-name aidb-vercel
aws iam attach-user-policy --user-name aidb-vercel --policy-arn <FeedbackWritePolicyArn>
aws iam create-access-key --user-name aidb-vercel    # capture the key + secret ONCE

aws iam create-user --user-name aidb-agent
aws iam attach-user-policy --user-name aidb-agent --policy-arn <AgentPolicyArn>
aws iam create-access-key --user-name aidb-agent
```

## 4. Wire the credentials

**Vercel project env** (feedback function):
```
AIDB_DDB_TABLE = aidb-feedback
AWS_REGION     = us-east-1
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY = aidb-vercel's keys
```

**GitHub Actions secrets** (the agent):
```
AIDB_STORE        = aws
AIDB_DDB_TABLE    = aidb-feedback
AIDB_S3_BUCKET    = aidb-archives-joeshsethi
AWS_REGION        = us-east-1
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY = aidb-agent's keys
```

## 5. Turn on feedback in the page
Uncomment `window.AIDB_FEEDBACK_URL = "/api/feedback"` in
`site/AiDailyBriefing/index.html`, deploy, and your 👍/👎/★ start flowing to DynamoDB.

## Tear down
```bash
aws cloudformation delete-stack --stack-name aidb-backend
```
(Empty the S3 bucket first if it has objects.)

## Cost
Pennies. DynamoDB on-demand + tiny S3 + a daily review query is well under the AWS
free tier for this volume.
