import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const baseEmails = [
  'Ptbhang0112@gmail.com',
  'bhang0112.miu@mail.com',
  'Tra.olong101@gmail.com',
  'Vuongngoclinh.1100@gmail.com',
  'phungthibichhang.10b5@gmail.com',
  'Nguyen10dat13@gmail.com',
  'Thuyanh.23081992@gmail.com',
  'bichdung17.10@gmail.com'
];

const outputDir = '/Users/danielngo/Desktop/tianxiwei-vote-assist/exports';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function generateDotAliases(email) {
  const [username, domain] = email.split('@');
  // Strip existing dots to compute all possible permutations.
  const cleanUsername = username.replace(/\./g, '');
  const len = cleanUsername.length;
  if (len <= 1) {
    return [email];
  }
  
  const aliases = [];
  const numCombinations = 1 << (len - 1);
  for (let i = 0; i < numCombinations; i++) {
    let current = '';
    for (let j = 0; j < len; j++) {
      current += cleanUsername[j];
      if (j < len - 1 && (i & (1 << j))) {
        current += '.';
      }
    }
    aliases.push(current + '@' + domain);
  }
  return aliases;
}

for (const baseEmail of baseEmails) {
  console.log(`Generating aliases for ${baseEmail}...`);
  const aliases = generateDotAliases(baseEmail);
  console.log(`Generated ${aliases.length} aliases for ${baseEmail}`);
  
  const data = aliases.map((email, index) => ({
    'STT': index + 1,
    'Email Alias': email,
    'Email Gốc': baseEmail
  }));
  
  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet['!cols'] = [
    { wch: 8 },  // STT
    { wch: 35 }, // Email Alias
    { wch: 30 }  // Email Gốc
  ];
  
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Email Aliases');
  
  const username = baseEmail.split('@')[0];
  const filePrefix = username.replace(/\./g, '_');
  const filePath = path.join(outputDir, `${filePrefix}_aliases.xlsx`);
  
  XLSX.writeFile(workbook, filePath);
  console.log(`Saved to ${filePath}`);
}

console.log('All files generated successfully!');
