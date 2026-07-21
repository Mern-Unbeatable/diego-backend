import { v2 as cloudinary } from 'cloudinary';

export class CloudinaryService {
  constructor(cloudName, apiKey, apiSecret) {
    this.cloudName = cloudName;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  init() {
    cloudinary.config({
      cloud_name: this.cloudName,
      api_key: this.apiKey,
      api_secret: this.apiSecret,
    });
  }
}