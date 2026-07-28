import { config } from './config.js';
import { PrismaClient } from '../generated/prisma/index.js';

export const prisma = new PrismaClient();

export const connectDatabase = async () => {
  await prisma.$connect();
};

export const disconnectDatabase = async () => {
  await prisma.$disconnect();
};