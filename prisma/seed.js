// prisma/seed.js — Seeds demo data for local development
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Kasi to Kasi database...');

  // Create test passenger
  const passHash = await bcrypt.hash('Test1234!', 12);

  const passenger = await prisma.user.upsert({
    where: { phone: '0811234567' },
    update: {},
    create: {
      name: 'Thabo Mokoena',
      phone: '0811234567',
      email: 'thabo@example.com',
      passwordHash: passHash,
      role: 'PASSENGER',
    },
  });

  // Create test driver
  const driver = await prisma.user.upsert({
    where: { phone: '0829876543' },
    update: {},
    create: {
      name: 'Sipho Ndlovu',
      phone: '0829876543',
      email: 'sipho@example.com',
      passwordHash: passHash,
      role: 'DRIVER',
      isDriverVerified: true,
      driverProfile: {
        create: {
          vehicleReg: 'GP 123-456',
          vehicleMake: 'Toyota',
          vehicleModel: 'Quantum',
          vehicleColor: 'White',
          vehicleYear: 2019,
          taxiAssociation: 'Soshanguve Taxi Association',
          licenseNumber: 'DL987654321',
          isOnline: false,
          currentLat: -25.4934,
          currentLng: 28.1028,
        },
      },
    },
  });

  // Create a sample route
  await prisma.route.upsert({
    where: { id: 'seed-route-001' },
    update: {},
    create: {
      id: 'seed-route-001',
      driverId: driver.id,
      originName: 'Soshanguve Block X',
      originLat: -25.4934,
      originLng: 28.1028,
      destinationName: 'Pretoria CBD',
      destinationLat: -25.7461,
      destinationLng: 28.1881,
      availableSeats: 10,
      totalSeats: 14,
      estimatedFare: 18.50,
      isActive: true,
      departureTime: new Date(Date.now() + 30 * 60 * 1000), // 30 mins from now
    },
  });

  console.log('✅ Seed complete!');
  console.log(`   Passenger: ${passenger.phone} / Test1234!`);
  console.log(`   Driver:    ${driver.phone} / Test1234!`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
