'use strict'

const path = require('path')
const fs = require('fs')

class ServerlessPlugin {
  constructor (serverless, options) {
    this.serverless = serverless
    this.options = options
    this.provider = this.serverless.getProvider('aws')
    this.region = this.serverless.service.provider.region

    this.commands = {
      share: {
        usage: 'Create a sharable CloudFormation template',
        lifecycleEvents: [
          'init',
          'template',
          'code',
          'end'
        ],
        options: {
          bucket: {
            usage:
              'Specify the destination S3 bucket' +
              '(e.g. "--bucket my-service-template-bucket" or "-b my-service-template-bucket")',
            required: false,
            shortcut: 'b'
          },
          codeKey: {
            usage:
              'Specify the artifact key uploaded to S3 bucket, by default it will use the severless key' +
              '(e.g. "--codeKey my-vendor/my-version/service.zip" or "-k my-vendor/my-version/service.zip")',
            required: false,
            shortcut: 'c'
          },
          templateKey: {
            usage:
              'Specify the artifact key uploaded to S3 bucket, by default it will use "template.json"' +
              '(e.g. "--templateKey template.json" or "-t template.json")',
            required: false,
            shortcut: 't'
          },
          stack: {
            usage:
              'Specify the stack name used in share link, by default it will use the service name' +
              '(e.g. "--stack my-service" or "-s my-service")',
            required: false,
            shortcut: 's'
          },
        }
      }
    }

    this.hooks = {
      'share:init': this.init.bind(this),

      'before:share:template': this.beforeTemplate.bind(this),
      'share:template': this.template.bind(this),
      'after:share:template': this.afterTemplate.bind(this),

      'before:share:code': this.beforeCode.bind(this),
      'share:code': this.code.bind(this),
      'after:share:code': this.afterCode.bind(this),

      'share:end': this.end.bind(this)
    }
  }

  /**
   * Init
   */
  async init () {
    this.deploymentBucket = await this.provider.getServerlessDeploymentBucketName()
    this.deploymentBucketPath = path.join(
      'serverless',
      this.serverless.service.service,
      this.serverless.service.provider.stage,
      '/'
    )
    this.latestVersion = await this.getLatestVersion()
    this.serverless.cli.log(`Deploying version ${this.latestVersion}..`)
    this.sourceKey = path.join(this.latestVersion, `${this.serverless.service.service}.zip`)
    this.shareConfig = {
      bucket: undefined,
      codeKey: this.sourceKey,
      templateKey: 'template.json',
      stackName: this.serverless.service.service,
      parameters: {},
      ...this.serverless.service.custom.share
    }
    this.destBucket = this.options.bucket || this.shareConfig.bucket
    this.destCodeKey = this.options.key || this.shareConfig.key
    this.destTemplateKey = this.options.key || this.shareConfig.key
    this.stackName = this.options.stackName || this.shareConfig.stackName
  }

  /**
   * Template hooks
   */
  beforeTemplate () {
    this.serverless.cli.log('Deploying CloudFormation template..')
  }
  async template () {
    let templateData = await this.getCurrentTemplate()
    templateData = this.elaborateTemplate(templateData)
    await this.saveTemplate(templateData)
  }
  afterTemplate () {
    this.serverless.cli.log('CloudFormation template is ready to share!')
  }

  /**
   * Code hooks
   */
  beforeCode () {
    this.serverless.cli.log('Deploying code archive..')
  }
  async code () {
    const tmpPath = '/tmp/code.zip';
    await this.downloadCode(tmpPath)
    await this.uploadCode(tmpPath)
    fs.unlinkSync(tmpPath)
  }
  afterCode () {
    this.serverless.cli.log('Code archive is ready to share!')
  }

  /**
   * End hook
   */
  async end () {
    this.serverless.cli.log(`Version ${this.latestVersion} deployed!`)
    const shareLink = 'https://console.aws.amazon.com/cloudformation/home#/stacks/new?' +
                      `stackName=${this.stackName}` +
                      'templateURL=https://' + await this.getDestinationBucketRegion() + 
                      `.amazonaws.com/${this.destBucket}/${this.templateKey}`
    this.serverless.cli.log(`Share link: ${shareLink}`)
  }

  /**
   * Get latest code version
   *
   * @returns {Promise}
   */
  async getLatestVersion () {
    const response = await this.provider.request('S3', 'listObjectsV2', {
      Bucket: this.deploymentBucket,
      Delimiter: '/',
      Prefix: this.deploymentBucketPath
    }, this.options.stage, this.region)

    const latestVersion = response.CommonPrefixes.sort().reverse()[0]
    if (latestVersion === undefined) {
      throw new Error('Version not found')
    }
    return latestVersion.Prefix
  }

  /**
   * Retrieve current template
   *
   * @returns {String}
   */
  async getCurrentTemplate () {
    const response = await this.provider.request('S3', 'getObject', {
      Bucket: this.deploymentBucket,
      Key: path.join(this.latestVersion, 'compiled-cloudformation-template.json')
    }, this.options.stage, this.region)

    return JSON.parse(response.Body)
  }

  /**
   * Elaborate template data
   *
   * @param {Object} templateData
   * @returns {Promise}
   */
  elaborateTemplate (templateData) {
    delete templateData.Resources.ServerlessDeploymentBucket

    for (const key in this.shareConfig.parameters) {
      const parameter = templateData.Parameters[key]
      if (parameter === undefined) {
        this.serverless.cli.log(`Rule ${key} cannot be applied, parameters not found`)
        continue
      }
      const rule = this.shareConfig.parameters[key]
      if (rule === 'required') {
        delete parameter.Default
      } else if (rule === 'optional') {
        parameter.Default = ''
      }
    }

    templateData.Resources
      .filter(resource => resource.Type === 'AWS::Lambda::Function')
      .forEach(resource => {
        if (
          resource.Properties && 
          resource.Properties.Code && 
          resource.Properties.S3Bucket && 
          resource.Properties.S3Bucket.Ref === 'ServerlessDeploymentBucket'
        ) {
          resource.Properties.S3Bucket = this.destBucket
          resource.Properties.S3Key = this.destCodeKey
        }
      })

    return templateData
  }

  /**
   * Save template
   *
   * @param {Object} templateData
   */
  async saveTemplate (templateData) {
    await this.provider.request('S3', 'putObject', {
      Bucket: this.destBucket,
      Key: this.destTemplateKey,
      ACL: 'public-read',
      ContentType: 'application/json',
      Body: JSON.stringify(templateData)
    }, this.options.stage, this.region)
  }

  /**
   * Download code
   *
   * @param {String} destPath
   */
  async downloadCode (destPath) {
    const response = await this.provider.request('S3', 'getObject', {
      Bucket: this.deploymentBucket,
      Key: this.sourceKey
    }, this.options.stage, this.region)

    fs.writeFileSync(destPath, response.Body)
  }

  /**
   * Upload code
   *
   * @param {String} srcPath
   */
  async uploadCode (srcPath) {
    await this.provider.request('S3', 'upload', {
      ACL: 'public-read',
      Bucket: this.destBucket,
      ContentType: 'application/zip',
      Key: this.destCodeKey,
      Body: fs.createReadStream(srcPath)
    }, this.options.stage, this.region)
  }

  /**
   * Get bucket region
   */
  async getDestinationBucketRegion () {
    const response = await this.provider.request('S3', 'getBucketLocation', {
      Bucket: this.destBucket,
    }, this.options.stage, this.region)
    return response.LocationConstraint
  }
}

module.exports = ServerlessPlugin
