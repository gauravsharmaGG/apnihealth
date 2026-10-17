// Minimal streaming ZIP writer (no dependencies): DEFLATE via node:zlib, CRC-32 via zlib.crc32 (Node >= 22.2).
// Files are written one at a time, so memory stays at one file. No ZIP64: refuses more than 65,535 entries or
// 4 GiB, which is far beyond one household's export.
import zlib from 'node:zlib';
const LIMIT=0xFFFFFFFF;
function dos(d=new Date()){
 return {time:(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),date:((Math.max(1980,d.getFullYear())-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate()};
}
export function zipWriter(write){
 let offset=0;const entries=[];const {time,date}=dos();
 return {
  add(name,data){
   const raw=Buffer.isBuffer(data)?data:Buffer.from(String(data),'utf8'),nameB=Buffer.from(String(name).replace(/^\/+/,''),'utf8');
   if(entries.length>=0xFFFF)throw Error('Too many files for one export');
   const crc=zlib.crc32(raw),deflated=zlib.deflateRawSync(raw),method=deflated.length<raw.length?8:0,body=method?deflated:raw;
   if(raw.length>=LIMIT||offset+30+nameB.length+body.length>=LIMIT)throw Error('Export too large');
   const h=Buffer.alloc(30);
   h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0800,6);h.writeUInt16LE(method,8);h.writeUInt16LE(time,10);h.writeUInt16LE(date,12);
   h.writeUInt32LE(crc,14);h.writeUInt32LE(body.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(nameB.length,26);h.writeUInt16LE(0,28);
   write(h);write(nameB);write(body);
   entries.push({nameB,crc,method,csize:body.length,usize:raw.length,offset});offset+=30+nameB.length+body.length;
  },
  end(){
   const start=offset;let size=0;
   for(const e of entries){
    const c=Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x0800,8);c.writeUInt16LE(e.method,10);c.writeUInt16LE(time,12);c.writeUInt16LE(date,14);
    c.writeUInt32LE(e.crc,16);c.writeUInt32LE(e.csize,20);c.writeUInt32LE(e.usize,24);c.writeUInt16LE(e.nameB.length,28);c.writeUInt32LE(e.offset,42);
    write(c);write(e.nameB);size+=46+e.nameB.length;
   }
   const z=Buffer.alloc(22);
   z.writeUInt32LE(0x06054b50,0);z.writeUInt16LE(entries.length,8);z.writeUInt16LE(entries.length,10);z.writeUInt32LE(size,12);z.writeUInt32LE(start,16);
   write(z);
  }
 };
}
