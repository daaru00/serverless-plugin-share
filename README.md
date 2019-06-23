# Serverless Share

[![npm](https://img.shields.io/npm/v/serverless-plugin-share.svg)](https://www.npmjs.com/package/serverless-plugin-share)

A [serverless](https://serverless.com) plugin to easily share CloudFormation template and code's artifact produced by serverless.

## Usage

### Installation

```bash
$ npm install serverless-plugin-share --save-dev
```
or using yarn
```bash
$ yarn add serverless-plugin-share
```

### Configuration

```yaml
plugins:
  - serverless-plugin-share

custom:
  share:
    bucket: my-public-bucket # (required) destination Bucket
    stack: my-deployed-service # (optional) stack name used in share link
    codeKey: my-service/deployed/code.zip # (optional) override code destination Key 
    templateKey: my-service/deployed/template.json # (optional) override template destination Key 
    parameters:
      MyRequiredParam: 'required' # (optional) parameter Default value will be removed
      MyOptionalParam: 'optional' # (optional) parameter Default value will be set to ''
```

### Deploy

Once configured you are now able to deploy your service into an sharable version uploaded into destination Bucket using the following command:

```bash
serverless share
```

You can also override `bucket` and `key` configuration:

```bash
serverless share \
    --bucket my-service-template-bucket \
    --codeKey my-vendor/my-version/code.zip \
    --templateKey my-vendor/my-version/template.json \
    --stack my-deployed-service
```

## Details

During download procedure the serverless artifact is downloaded and re-uploaded on the destination bucket. Produced CloudFormation template is downloaded, Parameters are parsed according to `parameters` settings and Lambda functions' code source is manipulated to point to destination bucket and key.

At the end of procedure will be printed a read-to-use share link, for example:
```
Share link: https://console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=example&templateURL=https://s3-eu-west-1.amazonaws.com/my-service-template-bucket/my-vendor/my-version/template.json
```


