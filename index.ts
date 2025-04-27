import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as docker from "@pulumi/docker";
import * as dotenv from "dotenv";

dotenv.config();

const CONTENTS_STAND_BY_QUEUE_NAME = process.env.CONTENTS_STAND_BY_QUEUE ?? "";
const CONTENTS_BUCKET_NAME = process.env.CONTENTS_BUCKET ?? "";
const CONTENTS_CONSUMER_LAMBDA_NAME = process.env.CONTENTS_CONSUMER_LAMBDA ?? "";
const CONTENTS_CONSUMER_LAMBDA_CODE_DEPLOY_ROLE_NAME = process.env.CONTENTS_CONSUMER_LAMBDA_CODE_DEPLOY_ROLE ?? "";
const CONTENTS_CONSUMER_LAMBDA_CODE_DEPLOY_ROLE_CODE_DEPLOY_ROLE_FOR_LAMBDA_POLICY_ATTACH_NAME = process.env.CONTENTS_CONSUMER_LAMBDA_CODE_DEPLOY_ROLE_CODE_DEPLOY_ROLE_FOR_LAMBDA_POLICY_ATTACH ?? "";
const CONTENTS_CONSUMER_LAMBDA_REPOSITORY_NAME = process.env.CONTENTS_CONSUMER_LAMBDA_REPOSITORY ?? "";
const CONTENTS_CONSUMER_LAMBDA_ROLE_ATTACHMENT_NAME = process.env.CONTENTS_CONSUMER_LAMBDA_ROLE_ATTACHMENT ?? "";
const CONTENTS_CONSUMER_LAMBDA_ROLE_SQS_ATTACHMENT_NAME = process.env.CONTENTS_CONSUMER_LAMBDA_ROLE_SQS_ATTACHMENT ?? "";
const CONTENTS_CONSUMER_LAMBDA_IMAGE_NAME = process.env.CONTENTS_CONSUMER_LAMBDA_IMAGE ?? "";

const contentsBucket = new aws.s3.BucketV2(CONTENTS_BUCKET_NAME);

const contentsConsumerLambdaRepository = new aws.ecr.Repository(CONTENTS_CONSUMER_LAMBDA_REPOSITORY_NAME, {
    imageTagMutability: "MUTABLE",
    imageScanningConfiguration: {
        scanOnPush: true,
    },
});

const contentsConsumerLambdaRepositoryAuthToken = aws.ecr.getAuthorizationTokenOutput({
    registryId: contentsConsumerLambdaRepository.registryId,
});

const contentsConsumerLambdaImage = new docker.Image(CONTENTS_CONSUMER_LAMBDA_IMAGE_NAME, {
    build: {
        dockerfile: "asset/Dockerfile",
        platform: "linux/amd64",
    },
    imageName: pulumi.interpolate`${contentsConsumerLambdaRepository.repositoryUrl}:latest`,
    registry: {
        password: pulumi.secret(contentsConsumerLambdaRepositoryAuthToken.password),
        server: contentsConsumerLambdaRepository.repositoryUrl,
        username: contentsConsumerLambdaRepositoryAuthToken.userName,
    },
    skipPush: true, // 처음 배포 시 false 로 설정
});

const contentsConsumerLambdaServiceRole = aws.iam.getPolicyDocument({
    statements: [{
        effect: "Allow",
        principals: [{
            type: "Service",
            identifiers: ["lambda.amazonaws.com"],
        }],
        actions: ["sts:AssumeRole"],
    }],
});

const contentsConsumerLambdaRole = new aws.iam.Role(CONTENTS_CONSUMER_LAMBDA_NAME, {
    name: 'lambda-role',
    assumeRolePolicy: contentsConsumerLambdaServiceRole.then(assumeRole => assumeRole.json),
});

const contentsConsumerLambdaRoleAttachment = new aws.iam.RolePolicyAttachment(CONTENTS_CONSUMER_LAMBDA_ROLE_ATTACHMENT_NAME, {
    role: contentsConsumerLambdaRole,
    policyArn: aws.iam.ManagedPolicies.AWSLambdaBasicExecutionRole,
});

const contentsConsumerLambdaRoleSqsAttachment = new aws.iam.RolePolicyAttachment(CONTENTS_CONSUMER_LAMBDA_ROLE_SQS_ATTACHMENT_NAME, {
    role: contentsConsumerLambdaRole,
    policyArn: aws.iam.ManagedPolicy.AWSLambdaSQSQueueExecutionRole,
});

const contentsConsumerLambda = new aws.lambda.Function(CONTENTS_CONSUMER_LAMBDA_NAME, {
    packageType: "Image",
    imageUri: pulumi.interpolate`${contentsConsumerLambdaRepository.repositoryUrl}:latest`,
    role: contentsConsumerLambdaRole.arn,
    architectures: ["x86_64"],
    memorySize: 1024,
    timeout: 30,
}, {dependsOn: [contentsConsumerLambdaImage]});

const contentsStandByQueue = new aws.sqs.Queue(CONTENTS_STAND_BY_QUEUE_NAME, {
    policy: aws.iam.getPolicyDocumentOutput({
        statements: [{
            effect: "Allow",
            principals: [{
                type: "*",
                identifiers: ["*"],
            }],
            actions: ["sqs:SendMessage"],
            resources: [`arn:aws:sqs:*:*:${CONTENTS_STAND_BY_QUEUE_NAME}-${pulumi.getStack()}`],
            conditions: [{
                test: "ArnEquals",
                variable: "aws:SourceArn",
                values: [contentsBucket.arn]
            }]
        }],
    }).apply(policy => policy.json),
});

const contentsCreatedBucketNotification = new aws.s3.BucketNotification("contents-created-bucket-notification", {
    bucket: contentsBucket.id,
    queues: [
        {
            id: 'contents-created-event',
            queueArn: contentsStandByQueue.arn,
            events: ["s3:ObjectCreated:*"],
            filterPrefix: "original/",
        }
    ],
});

const contentsStandByQueueEventSourceMapping = new aws.lambda.EventSourceMapping("contents-stand-by-queue-event-source-mapping", {
    eventSourceArn: contentsStandByQueue.arn,
    functionName: contentsConsumerLambda.name,
    batchSize: 10,
    enabled: true,
    functionResponseTypes: ['ReportBatchItemFailures'],
});

const codeDeployServiceRole = aws.iam.getPolicyDocument({
    statements: [{
        effect: "Allow",
        principals: [{
            type: "Service",
            identifiers: ["codedeploy.amazonaws.com"],
        }],
        actions: ["sts:AssumeRole"],
    }],
});

const contentsConsumerLambdaCodeDeployRole = new aws.iam.Role(CONTENTS_CONSUMER_LAMBDA_CODE_DEPLOY_ROLE_NAME, {
    assumeRolePolicy: codeDeployServiceRole.then(assumeRole => assumeRole.json),
});

const codeDeployRoleForLambdaPolicy = aws.iam.getPolicy({
    name: 'AWSCodeDeployRoleForLambda',
});

const contentsConsumerLambdaCodeDeployRoleAndCodeDeployRoleForLambdaPolicyAttach = new aws.iam.RolePolicyAttachment(CONTENTS_CONSUMER_LAMBDA_CODE_DEPLOY_ROLE_CODE_DEPLOY_ROLE_FOR_LAMBDA_POLICY_ATTACH_NAME, {
    role: contentsConsumerLambdaCodeDeployRole.name,
    policyArn: codeDeployRoleForLambdaPolicy.then(policy => policy.arn),
});

export const bucketName = contentsBucket.id;
